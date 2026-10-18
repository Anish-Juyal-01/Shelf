using System.Collections.Concurrent;
using Shelf.Core.Platform;

namespace Shelf.Core.Scanning;

/// <summary>What Shelf decided about a folder last time, valid while the folder's modified time is unchanged.</summary>
public sealed class ScanCacheEntry
{
    public long DirTicks { get; set; }
    public VerdictKind Kind { get; set; }
    public int Score { get; set; }
    public List<string> Signals { get; set; } = [];
    public string? Title { get; set; }
    public string? LaunchExe { get; set; }
    public List<string> PlayExes { get; set; } = [];
    public long? SizeBytes { get; set; }
    public DateTime? SizeMeasuredUtc { get; set; }
}

/// <summary>
/// Per-folder results that make re-scans incremental: a game root whose modified time hasn't changed (and whose exe is
/// still there) is reused without listing it or re-adding its size. Thread-safe.
/// </summary>
public sealed class ScanCache
{
    public ConcurrentDictionary<string, ScanCacheEntry> Entries { get; init; } = new();

    public bool TryGet(string path, DateTime dirWriteUtc, out ScanCacheEntry entry)
    {
        if (Entries.TryGetValue(PathUtil.Key(path), out entry!) && entry.DirTicks == dirWriteUtc.Ticks) return true;
        entry = null!;
        return false;
    }

    public void Set(string path, ScanCacheEntry entry) => Entries[PathUtil.Key(path)] = entry;

    /// <summary>Drops entries under <paramref name="root"/> that the last complete scan didn't see (deleted or moved games).</summary>
    public int Prune(string root, IReadOnlySet<string> touchedKeys)
    {
        var removed = 0;
        foreach (var key in Entries.Keys)
        {
            if (PathUtil.IsSameOrInside(key, root) && !touchedKeys.Contains(key) && Entries.TryRemove(key, out _)) removed++;
        }
        return removed;
    }
}
