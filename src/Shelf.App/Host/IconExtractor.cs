using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace Shelf.App.Host;

/// <summary>A program's own icon at 256 px (or the largest it has), as PNG bytes. Reads the exe's resources only.</summary>
internal static class IconExtractor
{
    public static byte[]? Png(string exePath, int size = 256)
    {
        if (!File.Exists(exePath)) return null;
        var handles = new IntPtr[1];
        var ids = new uint[1];
        try
        {
            var n = PrivateExtractIcons(exePath, 0, size, size, handles, ids, 1, 0);
            if (n == 0 || n == 0xFFFFFFFF || handles[0] == IntPtr.Zero) return null;
            using var icon = Icon.FromHandle(handles[0]);
            using var bmp = icon.ToBitmap();
            // An exe with no icon of its own gets Windows' generic one; that's no use as art.
            if (IsBlank(bmp)) return null;
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            return ms.ToArray();
        }
        catch (Exception e) when (e is ExternalException or ArgumentException or IOException)
        {
            return null;
        }
        finally
        {
            if (handles[0] != IntPtr.Zero) DestroyIcon(handles[0]);
        }
    }

    private static bool IsBlank(Bitmap bmp)
    {
        var opaque = 0;
        for (var y = 0; y < bmp.Height; y += 8)
            for (var x = 0; x < bmp.Width; x += 8)
                if (bmp.GetPixel(x, y).A > 16) opaque++;
        return opaque < 4;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);
}
