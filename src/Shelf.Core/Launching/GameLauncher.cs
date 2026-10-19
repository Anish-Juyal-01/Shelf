using System.Diagnostics;
using Shelf.Core.Model;
using Shelf.Core.Storage;

namespace Shelf.Core.Launching;

/// <summary>
/// Starts games and opens uninstallers. Only well-known store URI schemes and real .exe files are ever started —
/// never an arbitrary command line from the database — and uninstalling always goes through the launcher or
/// Windows' own Installed apps page: Shelf never deletes files itself.
/// </summary>
public static class GameLauncher
{
    private static readonly string[] LaunchSchemes =
    [
        "steam://", "com.epicgames.launcher://", "uplay://", "itch://", "amazon-games://", "goggalaxy://", "link2ea://", "origin2://",
        "battlenet://", @"shell:AppsFolder\",
    ];

    private static readonly string[] UninstallSchemes = ["steam://uninstall/", "com.epicgames.launcher://", "uplay://uninstall/", "ms-settings:"];

    public sealed record Result(bool Ok, string Message);

    public static bool CanLaunch(InstallDetail i) =>
        i.State == "installed" && (IsLaunchUri(i.LaunchUri) || (i.LaunchExe is not null && File.Exists(i.LaunchExe)));

    public static Result Launch(InstallDetail i)
    {
        try
        {
            if (IsLaunchUri(i.LaunchUri))
            {
                if (i.LaunchUri!.StartsWith(@"shell:AppsFolder\", StringComparison.OrdinalIgnoreCase))
                    Process.Start(new ProcessStartInfo("explorer.exe", i.LaunchUri) { UseShellExecute = false });
                else
                    Process.Start(new ProcessStartInfo(i.LaunchUri!) { UseShellExecute = true });
                return new Result(true, $"Starting through {i.Source.DisplayName()}");
            }
            if (i.LaunchExe is null || !i.LaunchExe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(i.LaunchExe))
                return new Result(false, "Shelf doesn't know which exe starts this game. Open its folder and run it once — Shelf will remember it.");
            Process.Start(new ProcessStartInfo(i.LaunchExe)
            {
                UseShellExecute = true,
                WorkingDirectory = i.WorkingDir is not null && Directory.Exists(i.WorkingDir) ? i.WorkingDir : Path.GetDirectoryName(i.LaunchExe)!,
                Arguments = i.LaunchArgs ?? "",
            });
            return new Result(true, "Starting");
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or FileNotFoundException)
        {
            return new Result(false, $"Couldn't start it: {e.Message}");
        }
    }

    /// <summary>Button label for the uninstall action, or null when Shelf can only offer "Open folder".</summary>
    public static string? UninstallLabel(InstallDetail i)
    {
        if (i.State != "installed") return null;
        var cmd = i.UninstallCommand;
        if (cmd is not null && cmd.StartsWith("steam://", StringComparison.OrdinalIgnoreCase)) return "Uninstall in Steam";
        if (cmd is not null && cmd.StartsWith("com.epicgames.launcher://", StringComparison.OrdinalIgnoreCase)) return "Uninstall in Epic";
        if (cmd is not null && cmd.StartsWith("uplay://", StringComparison.OrdinalIgnoreCase)) return "Uninstall in Ubisoft";
        if (cmd is not null || i.Source is SourceKind.Xbox or SourceKind.InstalledApps or SourceKind.Gog or SourceKind.Ea or SourceKind.Riot or SourceKind.BattleNet)
            return "Open Installed apps";
        return null;
    }

    public static Result Uninstall(InstallDetail i)
    {
        var target = i.UninstallCommand is not null && UninstallSchemes.Any(s => i.UninstallCommand.StartsWith(s, StringComparison.OrdinalIgnoreCase))
            ? i.UninstallCommand
            : "ms-settings:appsfeatures";
        try
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            return new Result(true, target.StartsWith("ms-settings:") ? $"Opened Installed apps — look for {Path.GetFileName(i.InstallPath)}" : "Opened the launcher's uninstaller");
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return new Result(false, $"Couldn't open the uninstaller: {e.Message}");
        }
    }

    private static bool IsLaunchUri(string? uri) =>
        uri is not null && LaunchSchemes.Any(s => uri.StartsWith(s, StringComparison.OrdinalIgnoreCase));
}
