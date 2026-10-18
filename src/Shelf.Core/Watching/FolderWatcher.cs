using System.Collections.Concurrent;
using Shelf.Core.Platform;

namespace Shelf.Core.Watching;

/// <summary>Remembers when each path last changed and hands it back once it has been quiet long enough.</summary>
public sealed class SettleQueue
{
    private readonly ConcurrentDictionary<string, (string Path, DateTime Last)> _pending = new();

    public int Count => _pending.Count;

    public void Touch(string path, DateTime nowUtc) => _pending[PathUtil.Key(path)] = (path, nowUtc);

    public List<string> TakeSettled(DateTime nowUtc, TimeSpan quiet)
    {
        var due = new List<string>();
        foreach (var (key, (path, last)) in _pending)
        {
            if (nowUtc - last < quiet) continue;
            if (_pending.TryRemove(new KeyValuePair<string, (string, DateTime)>(key, (path, last)))) due.Add(path);
        }
        return due;
    }
}

/// <summary>
/// Watches the scan folders for new downloads with <see cref="FileSystemWatcher"/> (event-driven, no polling).
/// Any change is attributed to the top-level entry it happened under (<c>Downloads\Some Game</c>), and that entry is
/// reported once nothing in it has changed for <c>quiet</c> — a 30 GB extraction isn't judged half-way through.
/// </summary>
public sealed class FolderWatcher : IDisposable
{
    private readonly IClock _clock;
    private readonly TimeSpan _quiet;
    private readonly List<(string Root, FileSystemWatcher Watcher)> _watchers = [];
    private readonly SettleQueue _queue = new();
    private readonly ConcurrentQueue<string> _overflowed = new();

    public IReadOnlyList<string> Roots => _watchers.Select(w => w.Root).ToList();

    /// <summary>Roots that couldn't be watched (missing, no access).</summary>
    public List<string> Failed { get; } = [];

    public FolderWatcher(IEnumerable<string> roots, IClock clock, TimeSpan quiet)
    {
        _clock = clock;
        _quiet = quiet;
        foreach (var root in roots.Select(PathUtil.Normalize).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                var w = new FileSystemWatcher(root)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.DirectoryName | NotifyFilters.FileName | NotifyFilters.Size | NotifyFilters.LastWrite,
                    InternalBufferSize = 64 * 1024,
                };
                w.Created += (_, e) => OnChange(root, e.FullPath);
                w.Changed += (_, e) => OnChange(root, e.FullPath);
                w.Renamed += (_, e) => OnChange(root, e.FullPath);
                w.Error += (_, _) => _overflowed.Enqueue(root);
                w.EnableRaisingEvents = true;
                _watchers.Add((root, w));
            }
            catch (Exception e) when (e is ArgumentException or IOException or UnauthorizedAccessException or FileNotFoundException)
            {
                Failed.Add(root);
            }
        }
    }

    internal void OnChange(string root, string fullPath)
    {
        var top = TopLevel(root, fullPath);
        if (top is not null) _queue.Touch(top, _clock.UtcNow);
    }

    /// <summary><c>D:\Downloads</c> + <c>D:\Downloads\Game\bin\a.dll</c> → <c>D:\Downloads\Game</c>.</summary>
    internal static string? TopLevel(string root, string fullPath)
    {
        var r = PathUtil.Normalize(root).TrimEnd('\\') + "\\";
        var p = PathUtil.Normalize(fullPath);
        if (!p.StartsWith(r, StringComparison.OrdinalIgnoreCase) || p.Length <= r.Length) return null;
        var rest = p[r.Length..];
        var slash = rest.IndexOf('\\');
        var name = slash < 0 ? rest : rest[..slash];
        // Browsers and tools write temp files while downloading; the final rename brings the real name.
        if (name.EndsWith(".crdownload", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".part", StringComparison.OrdinalIgnoreCase)
            || name.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase) || name.StartsWith('~'))
            return null;
        return r + name;
    }

    /// <summary>Entries that have settled, and roots whose change buffer overflowed (they need a full re-scan).</summary>
    public (List<string> Settled, List<string> Overflowed) Poll()
    {
        var overflowed = new List<string>();
        while (_overflowed.TryDequeue(out var r))
            if (!overflowed.Contains(r, StringComparer.OrdinalIgnoreCase)) overflowed.Add(r);
        return (_queue.TakeSettled(_clock.UtcNow, _quiet), overflowed);
    }

    public void Dispose()
    {
        foreach (var (_, w) in _watchers) w.Dispose();
        _watchers.Clear();
    }
}
