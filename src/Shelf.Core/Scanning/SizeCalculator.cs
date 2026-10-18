using System.IO.Enumeration;

namespace Shelf.Core.Scanning;

/// <summary>Adds up a folder's file sizes with one streaming enumeration. Never follows junctions or symlinks, never opens files.</summary>
public static class SizeCalculator
{
    private static readonly EnumerationOptions Options = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        // Skips junctions/symlinks (no loops, no double counting) and cloud placeholders.
        AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.Offline,
        ReturnSpecialDirectories = false,
    };

    public static long Measure(string path, CancellationToken ct = default)
    {
        if (!Directory.Exists(path)) return 0;
        var files = new FileSystemEnumerable<long>(path, (ref FileSystemEntry e) => e.Length, Options)
        {
            ShouldIncludePredicate = (ref FileSystemEntry e) => !e.IsDirectory,
        };
        long total = 0;
        var n = 0;
        try
        {
            foreach (var len in files)
            {
                total += len;
                if ((++n & 1023) == 0) ct.ThrowIfCancellationRequested();
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        return total;
    }
}
