using Shelf.Core.Platform;

namespace Shelf.Core.Sources;

/// <summary>One entry from Windows' "Installed apps" list (the Uninstall registry keys).</summary>
public sealed record UninstallEntry(
    string KeyName,
    string DisplayName,
    string? Publisher,
    string? InstallLocation,
    string? UninstallString,
    string? DisplayIcon,
    bool SystemComponent,
    bool HasParent)
{
    /// <summary>InstallLocation, or the folder of DisplayIcon's exe when the installer didn't record one.</summary>
    public string? ResolvedLocation
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(InstallLocation)) return PathUtil.Normalize(InstallLocation);
            var icon = PathUtil.ExeFromCommand(DisplayIcon);
            if (icon is null || !icon.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return null;
            if (icon.Contains(@"\Windows\Installer\", StringComparison.OrdinalIgnoreCase)) return null;
            var dir = Path.GetDirectoryName(PathUtil.Normalize(icon));
            return string.IsNullOrEmpty(dir) ? null : dir;
        }
    }
}

public static class UninstallEntries
{
    private static readonly string[] Roots =
    [
        @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        @"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        @"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    public static List<UninstallEntry> Read(IRegistryView reg)
    {
        var list = new List<UninstallEntry>();
        foreach (var root in Roots)
        {
            foreach (var name in reg.GetSubKeyNames(root))
            {
                var path = root + "\\" + name;
                var display = reg.GetValue(path, "DisplayName");
                if (string.IsNullOrWhiteSpace(display)) continue;
                list.Add(new UninstallEntry(
                    name,
                    display.Trim(),
                    reg.GetValue(path, "Publisher")?.Trim(),
                    reg.GetValue(path, "InstallLocation")?.Trim().Trim('"'),
                    reg.GetValue(path, "UninstallString"),
                    reg.GetValue(path, "DisplayIcon"),
                    reg.GetValue(path, "SystemComponent") == "1",
                    !string.IsNullOrEmpty(reg.GetValue(path, "ParentKeyName"))));
            }
        }
        return list;
    }
}
