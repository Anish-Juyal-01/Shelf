namespace Shelf.Core.Storage;

/// <summary>
/// Where Shelf keeps its own data. Nothing is ever written anywhere else (and never inside game folders).
/// <c>SHELF_DATA_DIR</c> moves both folders under one directory (tests, portable use).
/// </summary>
public sealed class ShelfPaths
{
    /// <summary>Settings and (from phase 3) the database: <c>%APPDATA%\Shelf</c>.</summary>
    public required string DataDir { get; init; }

    /// <summary>Disposable caches: <c>%LOCALAPPDATA%\Shelf</c>.</summary>
    public required string CacheDir { get; init; }

    public string SettingsFile => Path.Combine(DataDir, "settings.json");

    public string ScanCacheFile => Path.Combine(CacheDir, "scan-cache.json");

    public static ShelfPaths Default()
    {
        var overrideDir = Environment.GetEnvironmentVariable("SHELF_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(overrideDir))
            return new ShelfPaths { DataDir = overrideDir, CacheDir = Path.Combine(overrideDir, "cache") };
        return new ShelfPaths
        {
            DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Shelf"),
            CacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Shelf"),
        };
    }
}
