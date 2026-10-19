using Shelf.Core.Art;
using Shelf.Core.Storage;
using Shelf.Core.Tests.Support;

namespace Shelf.Core.Tests;

public class ArtTests
{
    [Fact]
    public void FindsSteamArtInBothCacheLayouts()
    {
        using var t = new TempTree();
        t.File("cache/620/aaa/library_capsule.jpg");
        t.File("cache/620/bbb/library_hero.jpg");
        t.File("cache/620/ccc/logo.png");
        t.File("cache/70_library_600x900.jpg");

        var found = new Dictionary<ArtKind, string>();
        ArtLocator.FindSteam(t.P("cache"), "620", found);
        Assert.EndsWith("library_capsule.jpg", found[ArtKind.Cover]);
        Assert.EndsWith("library_hero.jpg", found[ArtKind.Hero]);
        Assert.EndsWith("logo.png", found[ArtKind.Logo]);

        var old = new Dictionary<ArtKind, string>();
        ArtLocator.FindSteam(t.P("cache"), "70", old);
        Assert.EndsWith("70_library_600x900.jpg", old[ArtKind.Cover]);

        var bad = new Dictionary<ArtKind, string>();
        ArtLocator.FindSteam(t.P("cache"), "..\\..", bad);
        Assert.Empty(bad);
    }

    [Fact]
    public void FindsXboxLogosButNothingOutsideTheGame()
    {
        using var t = new TempTree();
        t.Text("Roblox/Content/MicrosoftGame.config", """
            <Game><ShellVisuals DefaultDisplayName="Roblox" Square480x480Logo="Assets/LargeLogo.png" SplashScreenImage="../../secret.png" /></Game>
            """);
        t.File("Roblox/Content/Assets/LargeLogo.png");
        t.File("secret.png");
        var found = new Dictionary<ArtKind, string>();
        ArtLocator.FindXbox(t.P("Roblox"), found);
        Assert.EndsWith("LargeLogo.png", found[ArtKind.Icon]);
        Assert.False(found.ContainsKey(ArtKind.Hero));
    }

    [Fact]
    public void CacheCopiesOnceAndOnlyServesItsOwnFiles()
    {
        using var t = new TempTree();
        var paths = new ShelfPaths { DataDir = t.P("data"), CacheDir = t.P("cachedir") };
        var art = new ArtCache(paths);
        var src = t.File("steam/cover.jpg", 100);

        Assert.True(art.Store(7, new Dictionary<ArtKind, string> { [ArtKind.Cover] = src }));
        Assert.False(art.Store(7, new Dictionary<ArtKind, string> { [ArtKind.Cover] = src }));
        Assert.NotNull(art.Get(7, ArtKind.Cover));
        Assert.NotNull(art.Resolve("7/cover.jpg"));
        Assert.Null(art.Resolve("7/../../steam/cover.jpg"));
        Assert.Null(art.Resolve("../x"));
        Assert.Null(art.Resolve("7/missing.jpg"));
        // The source is untouched.
        Assert.Equal(100, new FileInfo(src).Length);
    }
}
