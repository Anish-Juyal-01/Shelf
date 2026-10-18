using Shelf.Core.Dedup;
using Shelf.Core.Model;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;

namespace Shelf.Core.Library;

/// <summary>Everything Shelf knows right now: games, things to review, storage leftovers and per-source status.</summary>
public sealed class LibrarySnapshot
{
    public List<GameEntry> Games { get; init; } = [];
    public List<InstallRecord> Review { get; init; } = [];
    public List<LeftoverItem> Leftovers { get; init; } = [];
    public List<SourceResult> Sources { get; init; } = [];
    public List<ScanResult> Scans { get; init; } = [];
}

public static class LibraryBuilder
{
    /// <summary>Install folders the store readers already cover, plus the launchers' own folders; the folder scanner skips them.</summary>
    public static List<string> KnownInstallPaths(IEnumerable<SourceResult> sources, SystemContext? ctx = null) =>
        sources.SelectMany(s => s.Installs)
            .Where(i => i.IsInstalled && i.Source.IsStore())
            .Select(i => i.InstallPath)
            .Concat(ctx is null ? [] : Sources.LauncherDirs.Find(ctx))
            .ToList();

    /// <summary>
    /// Fills in what launchers don't record: the exe (via the classifier) and the size (measured, cached by folder
    /// modified time). Runs in parallel; read-only.
    /// </summary>
    public static void Enrich(IEnumerable<InstallRecord> records, ScanCache cache, bool measureSizes, CancellationToken ct = default)
    {
        var list = records.Where(r => r.IsInstalled).ToList();
        Parallel.ForEach(list, new ParallelOptions { CancellationToken = ct, MaxDegreeOfParallelism = 4 }, r =>
        {
            if (r.LaunchExe is null || r.PlayExes.Count == 0)
            {
                var v = FolderClassifier.Evaluate(r.InstallPath);
                r.LaunchExe ??= v.LaunchExe;
                foreach (var exe in v.PlayExes)
                    if (!r.PlayExes.Contains(exe, StringComparer.OrdinalIgnoreCase)) r.PlayExes.Add(exe);
            }
            r.WorkingDir ??= r.LaunchExe is null ? null : Path.GetDirectoryName(r.LaunchExe);

            if (!measureSizes || r.SizeBytes is not null) return;
            DateTime mtime;
            try { mtime = Directory.GetLastWriteTimeUtc(r.InstallPath); } catch (IOException) { return; } catch (UnauthorizedAccessException) { return; }
            var key = PathUtil.Key(r.InstallPath) + "|size";
            if (cache.Entries.TryGetValue(key, out var e) && e.DirTicks == mtime.Ticks && e.SizeBytes is not null)
            {
                r.SizeBytes = e.SizeBytes;
            }
            else
            {
                r.SizeBytes = SizeCalculator.Measure(r.InstallPath, ct);
                cache.Entries[key] = new ScanCacheEntry { DirTicks = mtime.Ticks, SizeBytes = r.SizeBytes, SizeMeasuredUtc = DateTime.UtcNow };
            }
            r.SizeSource = SizeSource.Measured;
        });
    }

    public static LibrarySnapshot Build(List<SourceResult> sources, List<ScanResult> scans, int libraryThreshold = 70)
    {
        var confident = new List<InstallRecord>();
        var review = new List<InstallRecord>();
        foreach (var r in sources.SelectMany(s => s.Installs))
            (r.Confidence >= libraryThreshold ? confident : review).Add(r);
        confident.AddRange(scans.SelectMany(s => s.Library));
        review.AddRange(scans.SelectMany(s => s.Review));

        var games = GameMatcher.Merge(confident);

        // A review item that's the same folder as a library game is already handled.
        var known = games.SelectMany(g => g.Installs).Select(i => i.InstallPath).ToList();
        var reviewMerged = GameMatcher.MergeSameFolder(review)
            .Where(r => !known.Any(k => PathUtil.IsSameOrInside(r.InstallPath, k)))
            .OrderByDescending(r => r.Confidence)
            .ToList();

        var leftovers = scans.SelectMany(s => s.Leftovers)
            .GroupBy(l => PathUtil.Key(l.Path))
            .Select(g => g.First())
            .OrderByDescending(l => l.SizeBytes)
            .ToList();

        return new LibrarySnapshot { Games = games, Review = reviewMerged, Leftovers = leftovers, Sources = sources, Scans = scans };
    }
}
