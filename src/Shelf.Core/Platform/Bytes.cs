using System.Globalization;

namespace Shelf.Core.Platform;

public static class Bytes
{
    public const long MB = 1024L * 1024;
    public const long GB = 1024L * MB;

    public static string Format(long? bytes)
    {
        if (bytes is null) return "?";
        var b = bytes.Value;
        return b switch
        {
            >= GB => (b / (double)GB).ToString(b >= 100 * GB ? "0" : "0.0", CultureInfo.InvariantCulture) + " GB",
            >= MB => (b / (double)MB).ToString("0", CultureInfo.InvariantCulture) + " MB",
            >= 1024 => (b / 1024.0).ToString("0", CultureInfo.InvariantCulture) + " KB",
            _ => b + " B",
        };
    }
}
