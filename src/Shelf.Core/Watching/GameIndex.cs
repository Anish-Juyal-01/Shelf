using Shelf.Core.Platform;
using Shelf.Core.Scanning;

namespace Shelf.Core.Watching;

/// <summary>
/// Maps a running exe to a game: an exact known exe first, otherwise "the exe lives inside a game's install folder"
/// (so store games work without knowing which of their exes is the game). Crash handlers, anti-cheat bootstrappers
/// and other helper exes never count as playing.
/// </summary>
public sealed class GameIndex
{
    private readonly IReadOnlyDictionary<string, long> _exes;
    private readonly List<(string Prefix, long GameId)> _roots;

    public GameIndex(IReadOnlyDictionary<string, long> exeKeys, IEnumerable<(string InstallPath, long GameId)> installs)
    {
        _exes = exeKeys;
        _roots = installs
            .Where(i => !string.IsNullOrWhiteSpace(i.InstallPath))
            .Select(i => (Prefix: PathUtil.Key(i.InstallPath), i.GameId))
            .Where(i => i.Prefix.Length > 3) // never a whole drive
            .Select(i => (i.Prefix.EndsWith('\\') ? i.Prefix : i.Prefix + "\\", i.GameId))
            .OrderByDescending(i => i.Item1.Length)
            .ToList();
    }

    public static readonly GameIndex Empty = new(new Dictionary<string, long>(), []);

    public int Count => _roots.Count;

    public long? Match(string? exePath)
    {
        if (string.IsNullOrEmpty(exePath)) return null;
        var key = PathUtil.Key(exePath);
        if (_exes.TryGetValue(key, out var id)) return id;
        var name = Path.GetFileName(exePath);
        if (ExeClassifier.IsNoise(name) || ExeClassifier.IsKnownApp(name)) return null;
        foreach (var (prefix, gameId) in _roots)
            if (key.StartsWith(prefix, StringComparison.Ordinal)) return gameId;
        return null;
    }
}
