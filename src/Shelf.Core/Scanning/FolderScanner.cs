using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading.Channels;
using Shelf.Core.Model;
using Shelf.Core.Platform;

namespace Shelf.Core.Scanning;

public sealed class ScanOptions
{
    public ClassifierOptions Classifier { get; init; } = ClassifierOptions.Default;

    /// <summary>Archives (.zip/.rar/.7z/.iso) at least this big are listed as storage leftovers.</summary>
    public long LeftoverArchiveBytes { get; init; } = Bytes.GB;

    public int MaxDepth { get; init; } = 12;

    public bool MeasureSizes { get; init; } = true;

    /// <summary>False forces every folder to be re-examined (the cache is still refreshed).</summary>
    public bool UseCache { get; init; } = true;

    /// <summary>Folders already known from store readers; not walked again.</summary>
    public IReadOnlyCollection<string> SkipPaths { get; init; } = [];

    public int Parallelism { get; init; } = Math.Clamp(Environment.ProcessorCount, 2, 8);
}

public enum LeftoverKind { Archive, Installer }

/// <summary>Something taking space that isn't an installed game: a big archive or an un-run installer.</summary>
public sealed record LeftoverItem(string Path, LeftoverKind Kind, string Title, long SizeBytes);

public enum ScanEventKind { Found, Leftover, Progress }

public sealed record ScanEvent(ScanEventKind Kind, string Path, int DirsVisited, InstallRecord? Install = null, LeftoverItem? Leftover = null);

public sealed class ScanResult
{
    public required string Root { get; init; }
    public bool DriveMode { get; init; }
    public List<InstallRecord> Library { get; } = [];
    public List<InstallRecord> Review { get; } = [];
    public List<LeftoverItem> Leftovers { get; } = [];
    public int DirsVisited { get; set; }
    public int Unreadable { get; set; }
    public int CacheHits { get; set; }
    public List<string> ErrorSamples { get; } = [];
    public TimeSpan Elapsed { get; set; }
    public bool Cancelled { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Walks a folder tree looking for games. Parallel, cancellable and incremental; stops descending as soon as a folder
/// is classified (a game root's insides are only touched to add up its size). Read-only: it lists folders and reads
/// file sizes, nothing else.
/// </summary>
public sealed class FolderScanner(ScanOptions? options = null, ScanCache? cache = null)
{
    private readonly ScanOptions _options = options ?? new ScanOptions();
    private readonly ScanCache _cache = cache ?? new ScanCache();

    private static readonly HashSet<string> SkipNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "$Recycle.Bin", "System Volume Information", "Windows", "WindowsApps", "WinSxS", "node_modules", ".git", ".svn", ".hg",
        "__pycache__", "$WinREAgent", "$SysReset", "$Windows.~BT", "$Windows.~WS", "Recovery", "PerfLogs", "Config.Msi",
        "OneDriveTemp", ".nuget", ".gradle", ".cache", ".vscode", "site-packages",
    };

    /// <summary>Skipped only when scanning a whole drive: system and per-user app data, covered by the store readers.</summary>
    private static readonly HashSet<string> DriveModeSkipNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "ProgramData", "AppData", "Program Files\\Common Files", "Common Files", "Microsoft", "Windows Kits",
        "Microsoft Visual Studio", "dotnet", "MSBuild", "Reference Assemblies", "Windows Defender", "Windows NT",
        "WindowsPowerShell", "Internet Explorer", "Microsoft Office", "NVIDIA Corporation", "Intel", "AMD",
        "Package Cache", "Installer", "msys64", "cygwin64",
    };

    private static readonly HashSet<string> LeftoverArchiveExtensions = new(StringComparer.OrdinalIgnoreCase)
        { ".zip", ".rar", ".7z", ".iso", ".tar", ".gz", ".xz", ".001" };

    private readonly record struct WorkItem(string Path, int Depth, DateTime WriteUtc);

    private static DateTime FreshWriteTime(string path, DateTime fallback)
    {
        try { return Directory.GetLastWriteTimeUtc(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return fallback; }
    }

    public ScanResult Scan(string root, Action<ScanEvent>? onEvent = null, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        var rootPath = PathUtil.Normalize(root);
        var driveMode = Path.GetPathRoot(rootPath)?.TrimEnd('\\') == rootPath.TrimEnd('\\');
        var result = new ScanResult { Root = rootPath, DriveMode = driveMode };
        if (!Directory.Exists(rootPath))
        {
            result.Error = $"Folder not found: {rootPath}";
            return result;
        }

        var skip = new HashSet<string>(_options.SkipPaths.Select(PathUtil.Key));
        var touched = new ConcurrentDictionary<string, byte>();
        var library = new ConcurrentBag<InstallRecord>();
        var review = new ConcurrentBag<InstallRecord>();
        var leftovers = new ConcurrentBag<LeftoverItem>();
        var errors = new ConcurrentQueue<string>();
        int dirs = 0, unreadable = 0, hits = 0, pending = 1;
        long lastProgress = 0;
        var gate = new object();

        var channel = Channel.CreateUnbounded<WorkItem>(new UnboundedChannelOptions { SingleReader = false, SingleWriter = false });
        channel.Writer.TryWrite(new WorkItem(rootPath, 0, Directory.GetLastWriteTimeUtc(rootPath)));

        void Emit(ScanEvent e)
        {
            if (onEvent is null) return;
            lock (gate) onEvent(e);
        }

        void Done()
        {
            if (Interlocked.Decrement(ref pending) == 0) channel.Writer.TryComplete();
        }

        void Process(WorkItem item)
        {
            var visited = Interlocked.Increment(ref dirs);
            var now = Environment.TickCount64;
            var last = Interlocked.Read(ref lastProgress);
            if (now - last > 200 && Interlocked.CompareExchange(ref lastProgress, now, last) == last)
                Emit(new ScanEvent(ScanEventKind.Progress, item.Path, visited));

            var key = PathUtil.Key(item.Path);
            // The modified time in the parent's listing comes from NTFS's directory index, which Windows updates
            // lazily; a patched game could look unchanged. Ask the folder itself (one cheap call, only for cached roots).
            if (_cache.Entries.ContainsKey(key)) item = item with { WriteUtc = FreshWriteTime(item.Path, item.WriteUtc) };
            if (_options.UseCache && item.Depth > 0 && _cache.TryGet(item.Path, item.WriteUtc, out var cached)
                && cached.Kind != VerdictKind.None && (cached.LaunchExe is null || File.Exists(cached.LaunchExe)))
            {
                Interlocked.Increment(ref hits);
                touched[key] = 0;
                Report(item.Path, cached);
                return;
            }

            DirListing listing;
            try { listing = DirListing.Read(item.Path); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
            {
                Interlocked.Increment(ref unreadable);
                if (errors.Count < 20) errors.Enqueue($"{item.Path}: {e.Message}");
                return;
            }

            foreach (var f in listing.Files)
            {
                if (f.Length >= _options.LeftoverArchiveBytes && LeftoverArchiveExtensions.Contains(Path.GetExtension(f.Name)))
                {
                    var leftover = new LeftoverItem(Path.Combine(item.Path, f.Name), LeftoverKind.Archive, Naming.NameCleaner.Clean(Path.GetFileNameWithoutExtension(f.Name)), f.Length);
                    leftovers.Add(leftover);
                    Emit(new ScanEvent(ScanEventKind.Leftover, leftover.Path, dirs, Leftover: leftover));
                }
            }

            var verdict = item.Depth == 0 && driveMode ? FolderVerdict.NotAGame : FolderClassifier.Evaluate(listing, _options.Classifier);
            if (verdict.Kind != VerdictKind.None)
            {
                if (!_cache.Entries.ContainsKey(key)) item = item with { WriteUtc = FreshWriteTime(item.Path, item.WriteUtc) };
                var entry = new ScanCacheEntry
                {
                    DirTicks = item.WriteUtc.Ticks,
                    Kind = verdict.Kind,
                    Score = verdict.Score,
                    Signals = verdict.Signals,
                    Title = verdict.Title,
                    LaunchExe = verdict.LaunchExe,
                    PlayExes = verdict.PlayExes,
                };
                // Keep a previous size if the folder itself didn't change; deep changes are caught by periodic re-measure.
                if (_options.UseCache && _cache.Entries.TryGetValue(key, out var old) && old.DirTicks == entry.DirTicks)
                {
                    entry.SizeBytes = old.SizeBytes;
                    entry.SizeMeasuredUtc = old.SizeMeasuredUtc;
                }
                if (_options.MeasureSizes && entry.SizeBytes is null)
                {
                    entry.SizeBytes = SizeCalculator.Measure(item.Path, ct);
                    entry.SizeMeasuredUtc = DateTime.UtcNow;
                }
                _cache.Set(item.Path, entry);
                touched[key] = 0;
                Report(item.Path, entry);
                return;
            }

            if (item.Depth >= _options.MaxDepth) return;
            var parentName = Path.GetFileName(item.Path);
            foreach (var d in listing.Dirs)
            {
                if (SkipNames.Contains(d.Name)) continue;
                if (driveMode && DriveModeSkipNames.Contains(d.Name)) continue;
                if (parentName.Equals("steamapps", StringComparison.OrdinalIgnoreCase)
                    && d.Name is "shadercache" or "workshop" or "downloading" or "temp" or "compatdata")
                    continue;
                var child = Path.Combine(item.Path, d.Name);
                if (skip.Contains(PathUtil.Key(child))) continue;
                Interlocked.Increment(ref pending);
                channel.Writer.TryWrite(new WorkItem(child, item.Depth + 1, d.LastWriteUtc));
            }
        }

        void Report(string path, ScanCacheEntry e)
        {
            if (e.Kind == VerdictKind.Installer)
            {
                var leftover = new LeftoverItem(path, LeftoverKind.Installer, e.Title ?? Path.GetFileName(path), e.SizeBytes ?? 0);
                leftovers.Add(leftover);
                Emit(new ScanEvent(ScanEventKind.Leftover, path, dirs, Leftover: leftover));
                return;
            }
            var record = new InstallRecord
            {
                Source = SourceKind.Folder,
                Title = e.Title ?? Path.GetFileName(path),
                InstallPath = path,
                LaunchExe = e.LaunchExe,
                WorkingDir = e.LaunchExe is null ? null : Path.GetDirectoryName(e.LaunchExe),
                Confidence = e.Score,
                Signals = [.. e.Signals],
                PlayExes = [.. e.PlayExes],
                SizeBytes = e.SizeBytes,
                SizeSource = e.SizeBytes is null ? SizeSource.Unknown : SizeSource.Measured,
            };
            (e.Score >= _options.Classifier.LibraryThreshold ? library : review).Add(record);
            Emit(new ScanEvent(ScanEventKind.Found, path, dirs, Install: record));
        }

        var workers = Enumerable.Range(0, _options.Parallelism).Select(_ => Task.Run(async () =>
        {
            var reader = channel.Reader;
            while (await reader.WaitToReadAsync(ct).ConfigureAwait(false))
            {
                while (reader.TryRead(out var item))
                {
                    try
                    {
                        ct.ThrowIfCancellationRequested();
                        Process(item);
                    }
                    finally { Done(); }
                }
            }
        }, ct)).ToArray();

        try { Task.WaitAll(workers); }
        catch (AggregateException e) when (e.InnerExceptions.All(x => x is OperationCanceledException)) { result.Cancelled = true; }
        if (ct.IsCancellationRequested) result.Cancelled = true;

        result.Library.AddRange(library.OrderBy(r => r.Title, StringComparer.OrdinalIgnoreCase));
        result.Review.AddRange(review.OrderByDescending(r => r.Confidence));
        result.Leftovers.AddRange(leftovers.OrderByDescending(l => l.SizeBytes));
        result.DirsVisited = dirs;
        result.Unreadable = unreadable;
        result.CacheHits = hits;
        result.ErrorSamples.AddRange(errors);
        if (!result.Cancelled) _cache.Prune(rootPath, touched.Keys.ToHashSet());
        result.Elapsed = sw.Elapsed;
        return result;
    }
}
