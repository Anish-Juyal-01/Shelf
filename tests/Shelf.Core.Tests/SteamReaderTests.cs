using Shelf.Core.Model;
using Shelf.Core.Sources;
using Shelf.Core.Tests.Support;

namespace Shelf.Core.Tests;

public class SteamReaderTests
{
    private static string Esc(string path) => path.Replace("\\", "\\\\");

    private static (TempTree Tree, Platform.SystemContext Ctx) Fixture()
    {
        var t = new TempTree();
        var steam = t.Dir("Program Files (x86)/Steam");
        var lib2 = t.Dir("D/SteamLibrary");
        t.Text("Program Files (x86)/Steam/steamapps/libraryfolders.vdf", $$"""
            "libraryfolders"
            {
                "0" { "path" "{{Esc(steam)}}" "apps" { "620" "12345" } }
                "1" { "path" "{{Esc(lib2)}}" }
                "2" { "path" "Z:\\NotPluggedIn" }
            }
            """);
        t.Text("Program Files (x86)/Steam/steamapps/appmanifest_620.acf", """
            "AppState" { "appid" "620" "name" "Portal 2" "installdir" "Portal 2" "StateFlags" "4" "SizeOnDisk" "12345" "LastPlayed" "1700000000" }
            """);
        t.Dir("Program Files (x86)/Steam/steamapps/common/Portal 2");
        t.Text("Program Files (x86)/Steam/steamapps/appmanifest_228980.acf", """
            "AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "Steamworks Shared" "StateFlags" "4" }
            """);
        t.Text("Program Files (x86)/Steam/steamapps/appmanifest_999.acf", """
            "AppState" { "appid" "999" "name" "Gone Game" "installdir" "Gone" "StateFlags" "4" }
            """);
        t.Text("D/SteamLibrary/steamapps/appmanifest_70.acf", """
            "AppState" { "appid" "70" "name" "Half-Life" "installdir" "Half-Life" "StateFlags" "1026" }
            """);
        t.Dir("D/SteamLibrary/steamapps/common/Half-Life");
        t.Text("Program Files (x86)/Steam/userdata/111/config/localconfig.vdf", """
            "UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" {
                "620" { "LastPlayed" "1710000000" "Playtime" "90" }
                "730" { "Playtime" "5000" }
            } } } } }
            """);
        t.Text("Program Files (x86)/Steam/userdata/222/config/localconfig.vdf", """
            "UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "Apps" { "620" { "Playtime" "30" } } } } } }
            """);
        var reg = new FakeRegistry().Set(@"HKLM\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", steam);
        return (t, TestContext.For(t, reg));
    }

    [Fact]
    public void ReadsLibrariesManifestsAndSkipsRedists()
    {
        var (t, ctx) = Fixture();
        using var _ = t;
        var result = new SteamReader().Read(ctx);

        Assert.Equal(SourceState.Partial, result.State);
        Assert.Contains("NotPluggedIn", result.Message);
        Assert.Equal(["Gone Game", "Half-Life", "Portal 2"], result.Installs.Select(i => i.Title).Order());

        var portal = result.Installs.Single(i => i.Title == "Portal 2");
        Assert.Equal("steam://rungameid/620", portal.LaunchUri);
        Assert.Equal("steam://uninstall/620", portal.UninstallCommand);
        Assert.Equal(12345, portal.SizeBytes);
        Assert.Equal(SizeSource.Manifest, portal.SizeSource);
        Assert.True(portal.IsInstalled);

        Assert.False(result.Installs.Single(i => i.Title == "Gone Game").IsInstalled);
    }

    [Fact]
    public void ImportsPlaytimeSummedAcrossAccounts()
    {
        var (t, ctx) = Fixture();
        using var _ = t;
        var portal = new SteamReader().Read(ctx).Installs.Single(i => i.Title == "Portal 2");
        Assert.Equal(120 * 60, portal.ImportedPlaySeconds);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1710000000), portal.ImportedLastPlayed);
    }

    [Fact]
    public void FlagsUnfinishedDownloads()
    {
        var (t, ctx) = Fixture();
        using var _ = t;
        var hl = new SteamReader().Read(ctx).Installs.Single(i => i.Title == "Half-Life");
        Assert.Contains(hl.Signals, s => s.Contains("not finished"));
    }

    [Fact]
    public void OldLibraryFormatIsUnderstood()
    {
        using var t = new TempTree();
        var steam = t.Dir("Steam");
        var lib = t.Dir("Lib");
        t.Text("Steam/steamapps/libraryfolders.vdf", $$"""
            "LibraryFolders" { "TimeNextStatsReport" "123" "1" "{{Esc(lib)}}" }
            """);
        var libs = SteamReader.ReadLibraryFolders(steam, out var error);
        Assert.Null(error);
        Assert.Equal(2, libs.Count);
    }

    [Fact]
    public void ReportsNotInstalled()
    {
        using var t = new TempTree();
        var result = new SteamReader().Read(TestContext.For(t));
        Assert.Equal(SourceState.NotInstalled, result.State);
        Assert.Equal("Steam isn't installed", result.Message);
    }
}
