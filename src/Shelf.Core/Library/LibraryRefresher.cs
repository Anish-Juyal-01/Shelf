using Shelf.Core.Model;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;
using Shelf.Core.Sources;
using Shelf.Core.Storage;

namespace Shelf.Core.Library;

/// <summary>Runs detection (launchers + remembered folders) and writes the result to the database.</summary>
public sealed class LibraryRefresher(SystemContext ctx, ShelfPaths paths, LibraryStore store, IClock clock)
{
    private readonly object _gate = new();
    private ScanCache? _cache;

    private ScanCache Cache => _cache ??= ScanCacheStore.Load(paths);

    public sealed record FullResult(LibrarySnapshot Snapshot, SyncResult Sync, TimeSpan Elapsed);

    public FullResult RefreshAll(bool measureSizes = true, Action<ScanEvent>? onEvent = null, CancellationToken ct = default)
    {
        lock (_gate)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var sources = SourceReaders.ReadAll(ctx, ct);
            var known = LibraryBuilder.KnownInstallPaths(sources, ctx);
            LibraryBuilder.Enrich(sources.SelectMany(s => s.Installs), Cache, measureSizes, ct);

            var scanner = new FolderScanner(new ScanOptions { SkipPaths = known, MeasureSizes = measureSizes }, Cache);
            var scans = new List<ScanResult>();
            foreach (var root in ShelfSettings.Load(paths).ScanRoots)
            {
                ct.ThrowIfCancellationRequested();
                scans.Add(Directory.Exists(root)
                    ? scanner.Scan(root, onEvent, ct)
                    : new ScanResult { Root = root, Error = $"Scan folder not reachable: {root}" });
            }
            ScanCacheStore.Save(paths, Cache);
            var snap = LibraryBuilder.Build(sources, scans);
            var sync = store.Sync(snap, clock.UtcNow);
            return new FullResult(snap, sync, sw.Elapsed);
        }
    }

    /// <summary>Re-scans one folder (a new download that just settled) and syncs only what it found.</summary>
    public (ScanResult Scan, SyncResult Sync) RefreshFolder(string path, CancellationToken ct = default) => RefreshFolder(path, null, ct);

    /// <summary>Scans one folder or a whole drive (not remembered as a scan folder) and syncs what it found.</summary>
    public (ScanResult Scan, SyncResult Sync) RefreshFolder(string path, Action<ScanEvent>? onEvent, CancellationToken ct = default)
    {
        lock (_gate)
        {
            var known = store.Installs()
                .Where(i => i.Source.IsStore())
                .Select(i => i.InstallPath)
                .Concat(LauncherDirs.Find(ctx))
                .ToList();
            var scanner = new FolderScanner(new ScanOptions { SkipPaths = known }, Cache);
            var scan = scanner.Scan(path, onEvent, ct);
            ScanCacheStore.Save(paths, Cache);
            var snap = LibraryBuilder.Build([], [scan]);
            return (scan, store.Sync(snap, clock.UtcNow));
        }
    }
}
