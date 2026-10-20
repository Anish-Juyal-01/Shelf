using Shelf.Core.Dedup;
using Shelf.Core.Library;
using Shelf.Core.Model;
using Shelf.Core.Scanning;

namespace Shelf.Core.Tests;

public class GameMatcherTests
{
    private static InstallRecord R(SourceKind source, string title, string path, long? size = null, bool installed = true) => new()
    {
        Source = source,
        Title = title,
        InstallPath = path,
        SizeBytes = size,
        IsInstalled = installed,
    };

    [Fact]
    public void SameFolderFromTwoSourcesIsOneInstallStoreFirst()
    {
        var folder = R(SourceKind.Folder, "Portal2", @"D:\Steam\steamapps\common\Portal 2", size: 999);
        folder.PlayExes.Add(@"D:\Steam\steamapps\common\Portal 2\portal2.exe");
        var steam = R(SourceKind.Steam, "Portal 2", @"d:\steam\steamapps\common\portal 2\");
        steam.LaunchUri = "steam://rungameid/620";

        var game = Assert.Single(GameMatcher.Merge([folder, steam]));
        var install = Assert.Single(game.Installs);
        Assert.Equal(SourceKind.Steam, install.Source);
        Assert.Equal("Portal 2", game.Title);
        Assert.Equal(999, install.SizeBytes);
        Assert.Single(install.PlayExes);
        Assert.Contains("Also found by: Folder", install.Signals);
    }

    [Fact]
    public void DetectionInsideAStoreInstallIsMerged()
    {
        var steam = R(SourceKind.Steam, "Elden Ring", @"D:\Steam\steamapps\common\ELDEN RING");
        var folder = R(SourceKind.Folder, "Game", @"D:\Steam\steamapps\common\ELDEN RING\Game");
        Assert.Single(Assert.Single(GameMatcher.Merge([steam, folder])).Installs);
    }

    [Fact]
    public void SameTitleInTwoFoldersIsOneGameWithTwoCopies()
    {
        var steam = R(SourceKind.Steam, "Sekiro™: Shadows Die Twice - GOTY Edition", @"C:\Steam\common\Sekiro", 15_000);
        var loose = R(SourceKind.InstalledApps, "Sekiro Shadows Die Twice GOTY Edition", @"C:\Games\Sekiro", 16_000);
        var game = Assert.Single(GameMatcher.Merge([loose, steam]));
        Assert.Equal(2, game.Installs.Count);
        Assert.True(game.HasDuplicates);
        Assert.Equal(SourceKind.Steam, game.Primary.Source);
        Assert.Equal(31_000, game.SizeBytes);
    }

    [Fact]
    public void MissingCopyDoesNotCountAsDuplicate()
    {
        var a = R(SourceKind.InstalledApps, "F1 22", @"C:\Games\F1 22", installed: false);
        var b = R(SourceKind.Folder, "F1 22", @"D:\Games\F1 22", 5);
        var game = Assert.Single(GameMatcher.Merge([a, b]));
        Assert.False(game.HasDuplicates);
        Assert.True(game.Primary.IsInstalled);
        Assert.Equal(5, game.SizeBytes);
    }

    [Fact]
    public void DifferentGamesStaySeparateAndAliasesJoin()
    {
        var games = GameMatcher.Merge([
            R(SourceKind.Xbox, "Roblox", @"C:\XboxGames\Roblox"),
            R(SourceKind.InstalledApps, "Roblox Player", @"C:\Users\x\AppData\Local\Roblox\Versions\v1"),
            R(SourceKind.Steam, "Portal", @"C:\Steam\common\Portal"),
        ]);
        Assert.Equal(2, games.Count);
        Assert.Equal(2, games.Single(g => g.Title == "Roblox").Installs.Count);
    }

    [Fact]
    public void BuildSplitsByConfidenceAndDropsReviewDuplicates()
    {
        var sources = new List<SourceResult>
        {
            new(SourceKind.Steam, SourceState.Ok, "", [R(SourceKind.Steam, "Stray", @"C:\Steam\common\Stray")]),
            new(SourceKind.InstalledApps, SourceState.Ok, "", [new InstallRecord { Source = SourceKind.InstalledApps, Title = "Maybe", InstallPath = @"C:\Maybe", Confidence = 40 }]),
        };
        var scan = new ScanResult { Root = @"C:\" };
        scan.Review.Add(new InstallRecord { Source = SourceKind.Folder, Title = "Stray bits", InstallPath = @"C:\Steam\common\Stray\Extras", Confidence = 50 });
        scan.Library.Add(R(SourceKind.Folder, "Celeste", @"C:\Games\Celeste"));

        var snap = LibraryBuilder.Build(sources, [scan]);
        Assert.Equal(["Celeste", "Stray"], snap.Games.Select(g => g.Title));
        Assert.Equal("Maybe", Assert.Single(snap.Review).Title);
    }

    [Fact]
    public void AliasedGamesGetTheirOwnName()
    {
        var games = GameMatcher.Merge([
            R(SourceKind.Xbox, "Minecraft Launcher", @"C:\XboxGames\Minecraft Launcher"),
            R(SourceKind.InstalledApps, "Sekiro Shadows Die Twice GOTY Edition", @"C:\Games\Sekiro"),
        ]);
        Assert.Equal(["Minecraft", "Sekiro Shadows Die Twice"], games.Select(g => g.Title));
        Assert.Equal("minecraft", games[0].Key);
    }
}
