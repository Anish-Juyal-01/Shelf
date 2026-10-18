namespace Shelf.Core.Platform;

public static class PathUtil
{
    /// <summary>Full path with backslashes, no quotes and no trailing separator (except on a drive root).</summary>
    public static string Normalize(string path)
    {
        var p = path.Trim().Trim('"').Replace('/', '\\');
        if (p.Length == 0) return p;
        try { p = Path.GetFullPath(p); } catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException) { }
        if (p.Length > 3) p = p.TrimEnd('\\');
        return p;
    }

    /// <summary>Case-insensitive comparison key for a path.</summary>
    public static string Key(string path) => Normalize(path).ToUpperInvariant();

    public static bool IsSameOrInside(string path, string parent)
    {
        var a = Key(path);
        var b = Key(parent);
        if (a == b) return true;
        if (!b.EndsWith('\\')) b += "\\";
        return a.StartsWith(b, StringComparison.Ordinal);
    }

    /// <summary>Directory.Exists that never throws on junk input.</summary>
    public static bool DirExists(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        try { return Directory.Exists(Normalize(path)); } catch { return false; }
    }

    public static bool FileExists(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        try { return File.Exists(Normalize(path)); } catch { return false; }
    }

    /// <summary>Strips a command line down to its exe path: <c>"C:\x\a.exe" /S</c> → <c>C:\x\a.exe</c>; <c>C:\x\a.exe,0</c> → <c>C:\x\a.exe</c>.</summary>
    public static string? ExeFromCommand(string? command)
    {
        if (string.IsNullOrWhiteSpace(command)) return null;
        var c = command.Trim();
        if (c.StartsWith('"'))
        {
            var end = c.IndexOf('"', 1);
            return end > 1 ? c[1..end] : null;
        }
        var exe = c.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        if (exe > 0) return c[..(exe + 4)];
        var comma = c.IndexOf(',');
        return comma > 0 ? c[..comma] : c;
    }
}
