using Microsoft.Win32;

namespace Shelf.Core.Platform;

/// <summary>
/// Read-only registry access. Paths start with the hive (<c>HKLM\SOFTWARE\…</c>, <c>HKCU\…</c>) and are read in
/// the 64-bit view, so <c>WOW6432Node</c> paths are written out explicitly.
/// </summary>
public interface IRegistryView
{
    IReadOnlyList<string> GetSubKeyNames(string path);

    /// <summary>String or integer value as text; null when missing.</summary>
    string? GetValue(string path, string name);
}

public sealed class WindowsRegistryView : IRegistryView
{
    public IReadOnlyList<string> GetSubKeyNames(string path)
    {
        try
        {
            using var key = Open(path);
            return key?.GetSubKeyNames() ?? [];
        }
        catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return [];
        }
    }

    public string? GetValue(string path, string name)
    {
        try
        {
            using var key = Open(path);
            var value = key?.GetValue(name);
            return value switch
            {
                null => null,
                string s => s,
                byte[] => null,
                string[] arr => string.Join(";", arr),
                _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture),
            };
        }
        catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return null;
        }
    }

    private static RegistryKey? Open(string path)
    {
        var slash = path.IndexOf('\\');
        var hiveName = slash < 0 ? path : path[..slash];
        var sub = slash < 0 ? "" : path[(slash + 1)..];
        var hive = hiveName.ToUpperInvariant() switch
        {
            "HKLM" or "HKEY_LOCAL_MACHINE" => RegistryHive.LocalMachine,
            "HKCU" or "HKEY_CURRENT_USER" => RegistryHive.CurrentUser,
            _ => throw new ArgumentException($"Unknown hive in '{path}'"),
        };
        var root = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64);
        return sub.Length == 0 ? root : root.OpenSubKey(sub, writable: false);
    }
}
