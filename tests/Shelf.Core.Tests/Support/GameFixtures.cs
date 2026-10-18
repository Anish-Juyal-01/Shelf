using Shelf.Core.Scanning;

namespace Shelf.Core.Tests.Support;

/// <summary>Miniature copies of real game layouts. "Large" data is 5 KB; tests use <see cref="Options"/> with a 1 KB threshold.</summary>
public static class GameFixtures
{
    public static readonly ClassifierOptions Options = new() { LargeDataBytes = 1000 };

    public static string Unity(TempTree t, string rel)
    {
        t.File($"{rel}/hollow_knight.exe", 600);
        t.File($"{rel}/UnityPlayer.dll");
        t.File($"{rel}/UnityCrashHandler64.exe");
        t.File($"{rel}/hollow_knight_Data/sharedassets0.assets", 5000);
        t.File($"{rel}/hollow_knight_Data/globalgamemanagers");
        t.File($"{rel}/MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll");
        return t.P(rel);
    }

    public static string Unreal(TempTree t, string rel)
    {
        t.File($"{rel}/Stray.exe", 300);
        t.File($"{rel}/Engine/Binaries/ThirdParty/PhysX3/Win64/PhysX3_x64.dll");
        t.File($"{rel}/Hk_project/Binaries/Win64/Stray-Win64-Shipping.exe", 900);
        t.File($"{rel}/Hk_project/Content/Paks/Hk_project-WindowsNoEditor.pak", 5000);
        return t.P(rel);
    }

    /// <summary>A FromSoftware-style loose copy: exe, Steam emulator files, big .bdt archives, an uninstaller.</summary>
    public static string LooseRepack(TempTree t, string rel)
    {
        t.File($"{rel}/sekiro.exe", 800);
        t.File($"{rel}/steam_api64.dll");
        t.File($"{rel}/steam_emu.ini");
        t.File($"{rel}/fmod_event64.dll");
        t.File($"{rel}/bink2w64.dll");
        t.File($"{rel}/Data1.bdt", 5000);
        t.File($"{rel}/Data1.bhd");
        t.File($"{rel}/unins000.exe");
        t.File($"{rel}/_CommonRedist/vcredist/2015/vc_redist.x64.exe");
        t.File($"{rel}/_CommonRedist/DirectX/Jun2010/DXSETUP.exe");
        return t.P(rel);
    }

    /// <summary>Exe in bin\x64 (Witcher/Cyberpunk layout) with data one level under the root.</summary>
    public static string BinX64(TempTree t, string rel)
    {
        t.File($"{rel}/bin/x64/thing.exe", 700);
        t.File($"{rel}/bin/x64/steam_api64.dll");
        t.File($"{rel}/bin/x64/bink2w64.dll");
        t.File($"{rel}/archives/basegame.archive", 5000);
        return t.P(rel);
    }

    public static string Electron(TempTree t, string rel)
    {
        t.File($"{rel}/Chatty.exe", 900);
        t.File($"{rel}/chrome_100_percent.pak");
        t.File($"{rel}/resources.pak", 5000);
        t.File($"{rel}/v8_context_snapshot.bin");
        t.File($"{rel}/ffmpeg.dll");
        t.File($"{rel}/resources/app.asar", 3000);
        t.File($"{rel}/locales/en-US.pak");
        return t.P(rel);
    }

    public static string FitGirlInstaller(TempTree t, string rel)
    {
        t.File($"{rel}/setup.exe", 200);
        t.File($"{rel}/fg-01.bin", 3000);
        t.File($"{rel}/fg-02.bin", 3000);
        t.File($"{rel}/MD5/QuickSFV.exe");
        return t.P(rel);
    }
}
