using Shelf.Core.Model;
using Shelf.Core.Sources;
using Shelf.Core.Tests.Support;

namespace Shelf.Core.Tests;

public class EpicReaderTests
{
    private const string Manifests = "ProgramData/Epic/EpicGamesLauncher/Data/Manifests";

    private static string Item(string appName, string display, string location, string extra = "") => $$"""
        {
          "AppName": "{{appName}}",
          "DisplayName": "{{display}}",
          "InstallLocation": "{{location.Replace("\\", "\\\\")}}",
          "LaunchExecutable": "Game/Binaries/Win64/Game.exe",
          "CatalogNamespace": "ns1",
          "CatalogItemId": "item1",
          "InstallSize": 4096,
          "AppCategories": ["public", "games", "applications"]{{extra}}
        }
        """;

    [Fact]
    public void ReadsGamesAndSkipsDlcIncompleteAndBrokenManifests()
    {
        using var t = new TempTree();
        var game = t.Dir("Epic Games/Hades");
        t.Text($"{Manifests}/a.item", Item("Hades", "Hades", game));
        t.Text($"{Manifests}/b.item", Item("HadesDLC", "Hades Soundtrack", game, ", \"MainGameAppName\": \"Hades\""));
        t.Text($"{Manifests}/c.item", Item("Other", "Half Downloaded", t.Dir("Epic Games/Other"), ", \"bIsIncompleteInstall\": true"));
        t.Text($"{Manifests}/d.item", "{ not json");

        var result = new EpicReader().Read(TestContext.For(t));

        Assert.Equal(SourceState.Partial, result.State);
        Assert.Contains("1 manifest couldn't be read", result.Message);
        var hades = Assert.Single(result.Installs);
        Assert.Equal("Hades", hades.Title);
        Assert.Equal("com.epicgames.launcher://apps/ns1%3Aitem1%3AHades?action=launch&silent=true", hades.LaunchUri);
        Assert.Equal(4096, hades.SizeBytes);
        Assert.EndsWith(@"Game\Binaries\Win64\Game.exe", hades.LaunchExe!.Replace('/', '\\'));
    }

    [Fact]
    public void NoLauncherIsNotInstalled()
    {
        using var t = new TempTree();
        Assert.Equal(SourceState.NotInstalled, new EpicReader().Read(TestContext.For(t)).State);
    }

    [Fact]
    public void LauncherWithoutManifestsIsReportedHonestly()
    {
        using var t = new TempTree();
        t.Dir("ProgramData/Epic/EpicGamesLauncher");
        var result = new EpicReader().Read(TestContext.For(t));
        Assert.Equal(SourceState.Unreadable, result.State);
        Assert.Contains("manifests folder wasn't found", result.Message);
    }

    [Fact]
    public void EmptyManifestsFolderSaysNoGames()
    {
        using var t = new TempTree();
        t.Dir(Manifests + "/Pending");
        var result = new EpicReader().Read(TestContext.For(t));
        Assert.Equal(SourceState.Ok, result.State);
        Assert.Equal("Epic Games Launcher found, no games installed", result.Message);
    }
}
