using System.Text;
using Microsoft.Data.Sqlite;
using Shelf.Core.Model;
using Shelf.Core.Sources;
using Shelf.Core.Tests.Support;

namespace Shelf.Core.Tests;

public class OtherReaderTests
{
    private const string Uninstall = @"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

    [Fact]
    public void Gog_ReadsGamesSkipsDlc()
    {
        using var t = new TempTree();
        var dir = t.Dir("GOG Games/Disco Elysium");
        var reg = new FakeRegistry()
            .Key(@"HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\1771589310", ("gameName", "Disco Elysium"), ("path", dir), ("exe", dir + @"\disco.exe"), ("workingDir", dir))
            .Key(@"HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\2000", ("gameName", "Disco OST"), ("path", dir), ("dependsOn", "1771589310"));
        var result = new GogReader().Read(TestContext.For(t, reg));
        var game = Assert.Single(result.Installs);
        Assert.Equal("Disco Elysium", game.Title);
        Assert.Equal(dir, game.WorkingDir);
        Assert.Contains(game.LaunchExe!, game.PlayExes);
    }

    [Fact]
    public void Gog_NothingRegisteredIsNotInstalled()
    {
        using var t = new TempTree();
        Assert.Equal(SourceState.NotInstalled, new GogReader().Read(TestContext.For(t)).State);
    }

    [Fact]
    public void Ubisoft_BuildsLaunchUri()
    {
        using var t = new TempTree();
        var dir = t.Dir("Ubisoft/Assassin's Creed Origins");
        var reg = new FakeRegistry()
            .Set(@"HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher", "InstallDir", t.Dir("Ubisoft Game Launcher"))
            .Set(@"HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\3539", "InstallDir", dir);
        var game = Assert.Single(new UbisoftReader().Read(TestContext.For(t, reg)).Installs);
        Assert.Equal("Assassin's Creed Origins", game.Title);
        Assert.Equal("uplay://launch/3539/0", game.LaunchUri);
    }

    [Fact]
    public void Rockstar_SkipsLauncherKeys()
    {
        using var t = new TempTree();
        var reg = new FakeRegistry()
            .Set(@"HKLM\SOFTWARE\WOW6432Node\Rockstar Games\Launcher", "InstallFolder", t.Dir("RL"))
            .Set(@"HKLM\SOFTWARE\WOW6432Node\Rockstar Games\Red Dead Redemption 2", "InstallFolder", t.Dir("RDR2"));
        var game = Assert.Single(new RockstarReader().Read(TestContext.For(t, reg)).Installs);
        Assert.Equal("Red Dead Redemption 2", game.Title);
    }

    [Fact]
    public void Ea_ReadsRegistryAndInstallerData()
    {
        using var t = new TempTree();
        var reg = new FakeRegistry()
            .Key(@"HKLM\SOFTWARE\WOW6432Node\Electronic Arts\EA Desktop", ("InstallSuccessful", "true"))
            .Set(@"HKLM\SOFTWARE\WOW6432Node\Electronic Arts\Battlefield 1", "Install Dir", t.Dir("BF1"));
        t.Text("Program Files/EA Games/It Takes Two/__Installer/installerdata.xml", """
            <DiPManifest><gameTitles><gameTitle locale="de_DE">Es braucht zwei</gameTitle><gameTitle locale="en_US">It Takes Two</gameTitle></gameTitles></DiPManifest>
            """);
        var result = new EaReader().Read(TestContext.For(t, reg));
        Assert.Equal(["Battlefield 1", "It Takes Two"], result.Installs.Select(i => i.Title).Order());
        Assert.Contains("encrypted", result.Message);
    }

    [Fact]
    public void Ea_NotInstalled()
    {
        using var t = new TempTree();
        Assert.Equal(SourceState.NotInstalled, new EaReader().Read(TestContext.For(t)).State);
    }

    [Fact]
    public void HoYoPlay_OnlyGamesWithAnInstallPath()
    {
        using var t = new TempTree();
        var reg = new FakeRegistry()
            .Set(@"HKCU\Software\Cognosphere\HYP\1_0", "InstallPath", t.Dir("HoYoPlay"))
            .Set(@"HKCU\Software\Cognosphere\HYP\1_0\hk4e_global", "GameInstallPath", "")
            .Set(@"HKCU\Software\Cognosphere\HYP\1_0\hkrpg_global", "GameInstallPath", t.Dir("HoYoPlay/games/Star Rail Games"));
        var game = Assert.Single(new HoYoPlayReader().Read(TestContext.For(t, reg)).Installs);
        Assert.Equal("Honkai: Star Rail", game.Title);
    }

    [Fact]
    public void Riot_LaunchesThroughRiotClient()
    {
        using var t = new TempTree();
        t.Text("ProgramData/Riot Games/RiotClientInstalls.json", """{ "rc_default": "C:/Riot Games/Riot Client/RiotClientServices.exe" }""");
        var reg = new FakeRegistry()
            .Key($@"{Uninstall}\Riot Game valorant.live", ("DisplayName", "VALORANT"), ("InstallLocation", t.Dir("Riot Games/VALORANT/live").Replace('\\', '/')))
            .Key($@"{Uninstall}\Riot Game Riot_Client.", ("DisplayName", "Riot Client"), ("InstallLocation", t.Dir("Riot Games/Riot Client")));
        var game = Assert.Single(new RiotReader().Read(TestContext.For(t, reg)).Installs);
        Assert.Equal("VALORANT", game.Title);
        Assert.Equal("--launch-product=valorant --launch-patchline=live", game.LaunchArgs);
        Assert.Equal(@"C:\Riot Games\Riot Client\RiotClientServices.exe", game.LaunchExe);
        Assert.True(game.IsInstalled);
    }

    [Fact]
    public void BattleNet_FromBlizzardUninstallEntries()
    {
        using var t = new TempTree();
        t.Dir("Program Files (x86)/Battle.net");
        var reg = new FakeRegistry()
            .Key($@"{Uninstall}\Overwatch", ("DisplayName", "Overwatch"), ("Publisher", "Blizzard Entertainment"), ("InstallLocation", t.Dir("Overwatch")),
                ("UninstallString", "\"C:\\ProgramData\\Battle.net\\Agent\\Blizzard Uninstaller.exe\" --lang=enUS --uid=prometheus"))
            .Key($@"{Uninstall}\Battle.net", ("DisplayName", "Battle.net"), ("Publisher", "Blizzard Entertainment"));
        var game = Assert.Single(new BattleNetReader().Read(TestContext.For(t, reg)).Installs);
        Assert.Equal("Overwatch", game.Title);
        Assert.NotNull(game.UninstallCommand);
    }

    [Fact]
    public void Xbox_PublisherIdMatchesWindows()
    {
        // Microsoft's own publisher hash, as seen in every Microsoft.* package family name.
        Assert.Equal("8wekyb3d8bbwe", XboxReader.PublisherId("CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"));
    }

    [Fact]
    public void Xbox_ReadsGamingRootAndConfig()
    {
        using var t = new TempTree();
        var root = new List<byte>(Encoding.ASCII.GetBytes("RGBX"));
        root.AddRange(BitConverter.GetBytes(1));
        root.AddRange(Encoding.Unicode.GetBytes("MyXbox\0"));
        File.WriteAllBytes(Path.Combine(t.Dir("drive"), ".GamingRoot"), [.. root]);
        t.Text("drive/MyXbox/Roblox/Content/MicrosoftGame.config", """
            <Game configVersion="1">
              <Identity Name="ROBLOXCorporation.RobloxGDK" Publisher="CN=6FEF9772-62F8-4C8B-8DE0-70F628846515" Version="1.0.0.0" />
              <ExecutableList><Executable Name="RobloxPlayerBeta.exe" Id="Game" /></ExecutableList>
              <ShellVisuals DefaultDisplayName="Roblox" />
            </Game>
            """);
        t.Dir("drive/MyXbox/GameSave/wgs");

        var result = new XboxReader().Read(TestContext.For(t));
        var game = Assert.Single(result.Installs);
        Assert.Equal("Roblox", game.Title);
        Assert.StartsWith(@"shell:AppsFolder\ROBLOXCorporation.RobloxGDK_", game.LaunchUri);
        Assert.EndsWith("!Game", game.LaunchUri);
        Assert.EndsWith(@"Content\RobloxPlayerBeta.exe", game.LaunchExe);
    }

    [Fact]
    public void Itch_ReadsCavesFromACopyOfTheDatabase()
    {
        using var t = new TempTree();
        var apps = t.Dir("AppData/itch/apps");
        t.Dir("AppData/itch/apps/celeste");
        var db = t.P("AppData/itch/db/butler.db");
        Directory.CreateDirectory(Path.GetDirectoryName(db)!);
        using (var c = new SqliteConnection($"Data Source={db};Pooling=False"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = $"""
                CREATE TABLE games (id INTEGER, title TEXT, classification TEXT);
                CREATE TABLE install_locations (id TEXT, path TEXT);
                CREATE TABLE caves (id TEXT, game_id INTEGER, install_folder_name TEXT, install_location_id TEXT);
                INSERT INTO games VALUES (1, 'Celeste', 'game'), (2, 'Some Tool', 'tool');
                INSERT INTO install_locations VALUES ('loc', '{apps.Replace("'", "''")}');
                INSERT INTO caves VALUES ('cave-1', 1, 'celeste', 'loc'), ('cave-2', 2, 'tool', 'loc');
                """;
            cmd.ExecuteNonQuery();
        }
        var before = File.GetLastWriteTimeUtc(db);

        var game = Assert.Single(new ItchReader().Read(TestContext.For(t)).Installs);
        Assert.Equal("Celeste", game.Title);
        Assert.Equal("itch://caves/cave-1/launch", game.LaunchUri);
        Assert.True(game.IsInstalled);
        Assert.Equal(before, File.GetLastWriteTimeUtc(db));
    }

    [Fact]
    public void Amazon_ReadsInstalledRows()
    {
        using var t = new TempTree();
        var db = t.P("LocalAppData/Amazon Games/Data/Games/Sql/GameInstallInfo.sqlite");
        Directory.CreateDirectory(Path.GetDirectoryName(db)!);
        var dir = t.Dir("Amazon Games/Library/Fallout 3");
        using (var c = new SqliteConnection($"Data Source={db};Pooling=False"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = $"""
                CREATE TABLE DbSet (Id TEXT, ProductTitle TEXT, InstallDirectory TEXT, Installed INTEGER);
                INSERT INTO DbSet VALUES ('amzn1.adg', 'Fallout 3', '{dir.Replace("'", "''")}', 1), ('x', 'Old', 'C:\\x', 0);
                """;
            cmd.ExecuteNonQuery();
        }
        var game = Assert.Single(new AmazonReader().Read(TestContext.For(t)).Installs);
        Assert.Equal("Fallout 3", game.Title);
        Assert.Equal("amazon-games://play/amzn1.adg", game.LaunchUri);
    }

    [Fact]
    public void InstalledApps_KeepsGamesAndStaleRepacksDropsApps()
    {
        using var t = new TempTree();
        var sekiro = GameFixtures.LooseRepack(t, "Games/Sekiro Shadows Die Twice GOTY Edition");
        var chatty = GameFixtures.Electron(t, "Apps/Chatty");
        var reg = new FakeRegistry()
            .Key($@"{Uninstall}\Sekiro_is1", ("DisplayName", "Sekiro Shadows Die Twice GOTY Edition"), ("InstallLocation", sekiro + "\\"),
                ("UninstallString", $"\"{sekiro}\\unins000.exe\""))
            .Key($@"{Uninstall}\{{892D}}_is1", ("DisplayName", "F1 22 Champions Edition MULTi11 - ElAmigos version 1.05"),
                ("Publisher", "Electronic Arts"), ("InstallLocation", t.P("Games/F1 22") + "\\"))
            .Key($@"{Uninstall}\Chatty", ("DisplayName", "Chatty"), ("InstallLocation", chatty))
            .Key($@"{Uninstall}\Steam App 620", ("DisplayName", "Portal 2"), ("InstallLocation", sekiro))
            .Key($@"{Uninstall}\{{a894}}", ("DisplayName", "EA app"), ("Publisher", "Electronic Arts"), ("DisplayIcon", t.P("Package Cache/x/EAappInstaller.exe")))
            .Key($@"{Uninstall}\Hidden", ("DisplayName", "Hidden Thing"), ("SystemComponent", "1"), ("InstallLocation", sekiro));

        var result = new InstalledAppsReader().Read(TestContext.For(t, reg));

        Assert.Equal(2, result.Installs.Count);
        var s = result.Installs.Single(i => i.IsInstalled);
        Assert.Equal("Sekiro Shadows Die Twice GOTY Edition", s.Title);
        Assert.True(s.Confidence >= 70, string.Join("\n", s.Signals));
        Assert.EndsWith("sekiro.exe", s.LaunchExe);
        var f1 = result.Installs.Single(i => !i.IsInstalled);
        Assert.Equal("F1 22 Champions Edition", f1.Title);
        Assert.Contains("1 listed but their folder is gone", result.Message);
    }
}
