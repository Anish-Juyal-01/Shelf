using System.Xml.Linq;
using Shelf.Core.Model;
using Shelf.Core.Platform;
using Shelf.Core.Sources;
using Shelf.Core.Storage;

namespace Shelf.Core.Art;

public enum ArtKind
{
    /// <summary>Portrait box art (2:3).</summary>
    Cover,
    /// <summary>Wide background art.</summary>
    Hero,
    /// <summary>Transparent title logo.</summary>
    Logo,
    /// <summary>Square program icon.</summary>
    Icon,
}

/// <summary>
/// Finds art that's already on this PC — no network: Steam's library cache (covers, hero images and logos for every
/// game it knows) and the logo/splash images Xbox games ship with. Read-only.
/// </summary>
public sealed class ArtLocator(SystemContext ctx)
{
    private readonly string? _steamCache = SteamReader.FindSteamPath(ctx) is { } s ? Path.Combine(s, "appcache", "librarycache") : null;

    public Dictionary<ArtKind, string> Find(InstallDetail install)
    {
        var found = new Dictionary<ArtKind, string>();
        if (install.Source == SourceKind.Steam && install.LaunchUri is { } uri && _steamCache is not null)
        {
            var appId = uri.Split('/').Last();
            FindSteam(_steamCache, appId, found);
        }
        if (install.Source == SourceKind.Xbox)
            FindXbox(install.InstallPath, found);
        return found;
    }

    /// <summary>
    /// Steam keeps art in <c>librarycache\&lt;appid&gt;\&lt;hash&gt;\library_capsule.jpg</c> (newer clients) or
    /// <c>librarycache\&lt;appid&gt;_library_600x900.jpg</c> (older ones).
    /// </summary>
    internal static void FindSteam(string cache, string appId, Dictionary<ArtKind, string> found)
    {
        if (!appId.All(char.IsDigit) || !Directory.Exists(cache)) return;
        var dir = Path.Combine(cache, appId);
        if (Directory.Exists(dir))
        {
            foreach (var f in SafeFiles(dir))
            {
                var name = Path.GetFileName(f).ToLowerInvariant();
                if (name is "library_capsule.jpg" or "library_600x900.jpg" or "library_600x900_2x.jpg") found.TryAdd(ArtKind.Cover, f);
                else if (name == "library_hero.jpg") found.TryAdd(ArtKind.Hero, f);
                else if (name == "logo.png") found.TryAdd(ArtKind.Logo, f);
            }
        }
        void Flat(string file, ArtKind kind)
        {
            var p = Path.Combine(cache, file);
            if (File.Exists(p)) found.TryAdd(kind, p);
        }
        Flat($"{appId}_library_600x900.jpg", ArtKind.Cover);
        Flat($"{appId}_library_hero.jpg", ArtKind.Hero);
        Flat($"{appId}_logo.png", ArtKind.Logo);
    }

    /// <summary>Xbox games name their images in MicrosoftGame.config (square logo, splash screen).</summary>
    internal static void FindXbox(string gameDir, Dictionary<ArtKind, string> found)
    {
        var content = Path.Combine(gameDir, "Content");
        var config = Path.Combine(content, "MicrosoftGame.config");
        if (!File.Exists(config)) return;
        try
        {
            var visuals = XDocument.Load(config).Descendants().FirstOrDefault(e => e.Name.LocalName == "ShellVisuals");
            if (visuals is null) return;
            void Try(string attr, ArtKind kind)
            {
                var rel = (string?)visuals.Attribute(attr);
                if (rel is null) return;
                var p = Path.GetFullPath(Path.Combine(content, rel.Replace('/', '\\')));
                if (PathUtil.IsSameOrInside(p, content) && File.Exists(p)) found.TryAdd(kind, p);
            }
            Try("Square480x480Logo", ArtKind.Icon);
            Try("Square150x150Logo", ArtKind.Icon);
            Try("SplashScreenImage", ArtKind.Hero);
        }
        catch (Exception e) when (e is IOException or System.Xml.XmlException or UnauthorizedAccessException) { }
    }

    private static IEnumerable<string> SafeFiles(string dir)
    {
        try { return Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).ToList(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
    }
}
