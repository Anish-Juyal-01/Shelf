using Shelf.Core.Scanning;
using Shelf.Core.Tests.Support;

namespace Shelf.Core.Tests;

public class FolderClassifierTests
{
    private static FolderVerdict Eval(string path) => FolderClassifier.Evaluate(path, GameFixtures.Options);

    [Fact]
    public void UnityGame()
    {
        using var t = new TempTree();
        var v = Eval(GameFixtures.Unity(t, "Games/Hollow Knight"));
        Assert.Equal(VerdictKind.Game, v.Kind);
        Assert.True(v.Score >= 70, string.Join("\n", v.Signals));
        Assert.Contains(v.Signals, s => s.Contains("Unity engine"));
        Assert.EndsWith("hollow_knight.exe", v.LaunchExe);
        Assert.DoesNotContain(v.PlayExes, e => e.Contains("UnityCrashHandler"));
        Assert.Equal("Hollow Knight", v.Title);
    }

    [Fact]
    public void UnrealGameOutsideAGamesFolder()
    {
        using var t = new TempTree();
        var v = Eval(GameFixtures.Unreal(t, "Stuff/Stray"));
        Assert.True(v.Score >= 70, string.Join("\n", v.Signals));
        Assert.EndsWith(@"\Stray.exe", v.LaunchExe);
        Assert.Contains(v.PlayExes, e => e.EndsWith("Stray-Win64-Shipping.exe"));
    }

    [Fact]
    public void LooseRepackWithSteamEmulator()
    {
        using var t = new TempTree();
        var v = Eval(GameFixtures.LooseRepack(t, "Games/Sekiro Shadows Die Twice GOTY Edition"));
        Assert.True(v.Score >= 70, string.Join("\n", v.Signals));
        Assert.EndsWith("sekiro.exe", v.LaunchExe);
        Assert.DoesNotContain(v.PlayExes, e => e.Contains("unins000") || e.Contains("vc_redist") || e.Contains("DXSETUP"));
    }

    [Fact]
    public void ExeInBinX64IsFoundFromTheRoot()
    {
        using var t = new TempTree();
        var root = GameFixtures.BinX64(t, "Games/Thing");
        var v = Eval(root);
        Assert.True(v.Score >= 70, string.Join("\n", v.Signals));
        Assert.EndsWith(@"bin\x64\thing.exe", v.LaunchExe);
        Assert.Equal("Thing", v.Title);
    }

    [Fact]
    public void ElectronAppIsNotAGame()
    {
        using var t = new TempTree();
        var v = Eval(GameFixtures.Electron(t, "Games/Chatty"));
        Assert.Equal(VerdictKind.None, v.Kind);
        Assert.Contains(v.Signals, s => s.Contains("Electron"));
    }

    [Fact]
    public void UnrealEditorIsNotAGame()
    {
        using var t = new TempTree();
        t.File("UE_5.4/Engine/Binaries/Win64/UnrealEditor.exe", 500);
        t.File("UE_5.4/UnrealEditor.exe", 500);
        Assert.Equal(VerdictKind.None, Eval(t.P("UE_5.4")).Kind);
    }

    [Fact]
    public void RedistOnlyFolderIsNothing()
    {
        using var t = new TempTree();
        t.File("_CommonRedist/vcredist/vc_redist.x64.exe", 5000);
        t.File("_CommonRedist/DirectX/DXSETUP.exe", 5000);
        Assert.Equal(VerdictKind.None, Eval(t.P("_CommonRedist/vcredist")).Kind);
        Assert.Equal(VerdictKind.None, Eval(t.P("_CommonRedist/DirectX")).Kind);
    }

    [Fact]
    public void UnrunInstallerIsALeftover()
    {
        using var t = new TempTree();
        var v = Eval(GameFixtures.FitGirlInstaller(t, "Downloads/Elden Ring [FitGirl Repack]"));
        Assert.Equal(VerdictKind.Installer, v.Kind);
        Assert.Equal("Elden Ring", v.Title);
    }

    [Fact]
    public void PlainExeIsTooWeakAlone()
    {
        using var t = new TempTree();
        t.File("Tools/thing/thing.exe", 500);
        Assert.Equal(VerdictKind.None, Eval(t.P("Tools/thing")).Kind);
    }

    [Theory]
    [InlineData("unins000.exe", true)]
    [InlineData("UnityCrashHandler64.exe", true)]
    [InlineData("vc_redist.x64.exe", true)]
    [InlineData("UE4PrereqSetup_x64.exe", true)]
    [InlineData("CrashReportClient.exe", true)]
    [InlineData("EasyAntiCheat_EOS_Setup.exe", true)]
    [InlineData("start_protected_game.exe", true)]
    [InlineData("hollow_knight.exe", false)]
    [InlineData("Setup Assistant.exe", true)]
    [InlineData("Commandos.exe", false)]
    [InlineData("eldenring.exe", false)]
    public void NoiseExes(string name, bool noise) => Assert.Equal(noise, ExeClassifier.IsNoise(name));
}
