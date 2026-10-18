namespace Shelf.Core.Scanning;

public readonly record struct FileEntry(string Name, long Length);

public readonly record struct DirEntry(string Name, DateTime LastWriteUtc);

/// <summary>One directory's direct children, read with a single enumeration (no per-file stat calls).</summary>
public sealed class DirListing
{
    /// <summary>Cloud placeholders (OneDrive "online-only") and offline files: never open or descend, or Windows downloads them.</summary>
    private const FileAttributes CloudAttributes = FileAttributes.Offline | (FileAttributes)0x00040000 /* RECALL_ON_OPEN */ | (FileAttributes)0x00400000 /* RECALL_ON_DATA_ACCESS */;

    private static readonly EnumerationOptions Options = new()
    {
        RecurseSubdirectories = false,
        IgnoreInaccessible = false,
        AttributesToSkip = 0,
        ReturnSpecialDirectories = false,
    };

    public required string Path { get; init; }
    public List<FileEntry> Files { get; } = [];
    public List<DirEntry> Dirs { get; } = [];

    /// <summary>Junctions/symlinks and cloud-only folders that were deliberately not listed as children.</summary>
    public int SkippedLinks { get; set; }

    public bool HasDir(string name) => Dirs.Any(d => d.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

    public bool HasFile(string name) => Files.Any(f => f.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

    public string? DirName(string name) => Dirs.FirstOrDefault(d => d.Name.Equals(name, StringComparison.OrdinalIgnoreCase)).Name;

    /// <summary>Lists a directory. Throws on access errors so the caller can count them.</summary>
    public static DirListing Read(string path)
    {
        var listing = new DirListing { Path = path };
        foreach (var info in new DirectoryInfo(path).EnumerateFileSystemInfos("*", Options))
        {
            var attrs = info.Attributes;
            if ((attrs & FileAttributes.Directory) != 0)
            {
                if ((attrs & (FileAttributes.ReparsePoint | CloudAttributes)) != 0) { listing.SkippedLinks++; continue; }
                listing.Dirs.Add(new DirEntry(info.Name, info.LastWriteTimeUtc));
            }
            else
            {
                listing.Files.Add(new FileEntry(info.Name, ((FileInfo)info).Length));
            }
        }
        return listing;
    }

    public static DirListing? TryRead(string path)
    {
        try { return Read(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException) { return null; }
    }
}
