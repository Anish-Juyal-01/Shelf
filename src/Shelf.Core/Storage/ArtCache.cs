using System.Text.Json;
using Shelf.Core.Art;

namespace Shelf.Core.Storage;

/// <summary>
/// Shelf's own copy of each game's art: <c>%LOCALAPPDATA%\Shelf\art\&lt;gameId&gt;\cover.jpg</c> etc. The UI only
/// ever reads from here, so showing art never touches launcher or game folders. Copies are refreshed when the
/// source changes.
/// </summary>
public sealed class ArtCache(ShelfPaths paths)
{
    public string Root { get; } = Path.Combine(paths.CacheDir, "art");

    private static string FileName(ArtKind kind, string sourceExt) => kind.ToString().ToLowerInvariant() + sourceExt.ToLowerInvariant();

    /// <summary>Copies any new or changed art for a game. Returns true when something changed.</summary>
    public bool Store(long gameId, IReadOnlyDictionary<ArtKind, string> sources)
    {
        var dir = Path.Combine(Root, gameId.ToString());
        var changed = false;
        foreach (var (kind, source) in sources)
        {
            try
            {
                var target = Path.Combine(dir, FileName(kind, Path.GetExtension(source)));
                var info = new FileInfo(source);
                if (!info.Exists || info.Length > 20 * 1024 * 1024) continue;
                if (File.Exists(target) && File.GetLastWriteTimeUtc(target) == info.LastWriteTimeUtc && new FileInfo(target).Length == info.Length) continue;
                Directory.CreateDirectory(dir);
                // Remove a stale copy with another extension (e.g. .png → .jpg).
                foreach (var old in Directory.EnumerateFiles(dir, kind.ToString().ToLowerInvariant() + ".*"))
                    if (!old.Equals(target, StringComparison.OrdinalIgnoreCase)) File.Delete(old);
                using (var src = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var dst = new FileStream(target + ".tmp", FileMode.Create, FileAccess.Write))
                    src.CopyTo(dst);
                File.Move(target + ".tmp", target, overwrite: true);
                File.SetLastWriteTimeUtc(target, info.LastWriteTimeUtc);
                changed = true;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
        return changed;
    }

    /// <summary>Saves generated art (an extracted exe icon) for a game.</summary>
    public void Write(long gameId, ArtKind kind, string extension, ReadOnlySpan<byte> bytes)
    {
        var dir = Path.Combine(Root, gameId.ToString());
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(Path.Combine(dir, FileName(kind, extension)), bytes.ToArray());
    }

    public bool Has(long gameId, ArtKind kind) => Get(gameId, kind) is not null;

    /// <summary>When a game's art was last looked up on the web, what it matched, and whether SteamGridDB was used.</summary>
    public sealed record WebLookup(DateTime Tried, string? Match, bool WithGrid);

    private string WebFile(long gameId) => Path.Combine(Root, gameId.ToString(), "web.json");

    public WebLookup? WebMark(long gameId)
    {
        try { return File.Exists(WebFile(gameId)) ? JsonSerializer.Deserialize<WebLookup>(File.ReadAllText(WebFile(gameId))) : null; }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { return null; }
    }

    public void MarkWeb(long gameId, WebLookup mark)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(WebFile(gameId))!);
        File.WriteAllText(WebFile(gameId), JsonSerializer.Serialize(mark));
    }

    /// <summary>The cached file for a game's art, or null.</summary>
    public string? Get(long gameId, ArtKind kind)
    {
        var dir = Path.Combine(Root, gameId.ToString());
        if (!Directory.Exists(dir)) return null;
        return Directory.EnumerateFiles(dir, kind.ToString().ToLowerInvariant() + ".*").FirstOrDefault(f => !f.EndsWith(".tmp"));
    }

    /// <summary>Resolves a request like "12/cover.jpg" to a file inside the cache — nothing outside it, ever.</summary>
    public string? Resolve(string relative)
    {
        var parts = relative.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2 || !long.TryParse(parts[0], out _) || parts[1].Contains("..") || parts[1].EndsWith(".json", StringComparison.OrdinalIgnoreCase)) return null;
        var full = Path.GetFullPath(Path.Combine(Root, parts[0], parts[1]));
        return full.StartsWith(Path.GetFullPath(Root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && File.Exists(full) ? full : null;
    }
}
