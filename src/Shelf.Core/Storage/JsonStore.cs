using System.Text.Json;
using System.Text.Json.Serialization;
using Shelf.Core.Scanning;

namespace Shelf.Core.Storage;

/// <summary>Atomic JSON load/save for Shelf's own files (write to .tmp, then replace).</summary>
public static class JsonStore
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static T Load<T>(string path) where T : new()
    {
        try
        {
            if (!File.Exists(path)) return new T();
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options) ?? new T();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new T();
        }
    }

    public static void Save<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, Options));
        File.Move(tmp, path, overwrite: true);
    }
}

/// <summary>User settings. Phase 2 only needs the scan roots; the app adds theme, API keys and so on.</summary>
public sealed class ShelfSettings
{
    public List<string> ScanRoots { get; set; } = [];

    public static ShelfSettings Load(ShelfPaths paths) => JsonStore.Load<ShelfSettings>(paths.SettingsFile);

    public void Save(ShelfPaths paths) => JsonStore.Save(paths.SettingsFile, this);
}

public static class ScanCacheStore
{
    public static ScanCache Load(ShelfPaths paths) => JsonStore.Load<ScanCache>(paths.ScanCacheFile);

    public static void Save(ShelfPaths paths, ScanCache cache) => JsonStore.Save(paths.ScanCacheFile, cache);
}
