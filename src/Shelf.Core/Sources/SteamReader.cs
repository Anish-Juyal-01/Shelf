using Shelf.Core.Model;
using Shelf.Core.Platform;
using Shelf.Core.Sources.Vdf;

namespace Shelf.Core.Sources;

/// <summary>
/// Steam: registry → <c>steamapps\libraryfolders.vdf</c> → each library's <c>appmanifest_*.acf</c>.
/// Also imports Steam's own playtime from <c>userdata\*\config\localconfig.vdf</c>.
/// </summary>
public sealed class SteamReader : ISourceReader
{
    public SourceKind Kind => SourceKind.Steam;

    /// <summary>Steam "apps" that aren't games: redistributables, runtimes, Proton, SteamVR, Wallpaper Engine.</summary>
    internal static readonly HashSet<string> NonGameAppIds =
    [
        "228980",  // Steamworks Common Redistributables
        "431960",  // Wallpaper Engine
        "250820",  // SteamVR
        "1070560", "1391110", "1628350", // Steam Linux Runtime
        "1493710", "1887720", "2348590", // Proton
        "1826330", // Proton EasyAntiCheat Runtime
        "1161040", // Proton BattlEye Runtime
        "1007",    // Steamworks SDK Redist
        "365670",  // Blender
    ];

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var steamPath = FindSteamPath(ctx);
        if (steamPath is null) return SourceResult.NotInstalled(Kind, "Steam isn't installed");

        var libraries = ReadLibraryFolders(steamPath, out var libraryError);
        var installs = new List<InstallRecord>();
        var problems = new List<string>();
        if (libraryError is not null) problems.Add(libraryError);

        foreach (var lib in libraries)
        {
            ct.ThrowIfCancellationRequested();
            var steamapps = Path.Combine(lib, "steamapps");
            if (!Directory.Exists(steamapps))
            {
                problems.Add($"Library {lib} isn't reachable (drive unplugged?)");
                continue;
            }
            foreach (var acf in Directory.EnumerateFiles(steamapps, "appmanifest_*.acf"))
            {
                try
                {
                    var record = ReadManifest(acf, steamapps);
                    if (record is not null) installs.Add(record);
                }
                catch (Exception e) when (e is IOException or FormatException or UnauthorizedAccessException)
                {
                    problems.Add($"{Path.GetFileName(acf)} couldn't be read");
                }
            }
        }

        ApplyPlaytime(steamPath, installs);

        var summary = $"{SourceReaders.Plural(installs.Count, "game")} in {SourceReaders.Plural(libraries.Count, "library")}";
        return problems.Count == 0
            ? new SourceResult(Kind, SourceState.Ok, summary, installs)
            : new SourceResult(Kind, SourceState.Partial, summary + " · " + string.Join("; ", problems), installs);
    }

    internal static string? FindSteamPath(SystemContext ctx)
    {
        string?[] candidates =
        [
            // HKLM first: HKCU's SteamPath is often all lower-case with forward slashes.
            ctx.Registry.GetValue(@"HKLM\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
            ctx.Registry.GetValue(@"HKLM\SOFTWARE\Valve\Steam", "InstallPath"),
            ctx.Registry.GetValue(@"HKCU\Software\Valve\Steam", "SteamPath"),
            Path.Combine(ctx.ProgramFilesX86, "Steam"),
        ];
        return candidates.Where(PathUtil.DirExists).Select(p => PathUtil.Normalize(p!)).FirstOrDefault();
    }

    internal static List<string> ReadLibraryFolders(string steamPath, out string? error)
    {
        error = null;
        var libs = new List<string> { steamPath };
        var file = new[] { Path.Combine(steamPath, "steamapps", "libraryfolders.vdf"), Path.Combine(steamPath, "config", "libraryfolders.vdf") }
            .FirstOrDefault(File.Exists);
        if (file is null) return libs;
        try
        {
            var root = VdfParser.ParseFile(file);
            var folders = root["libraryfolders"] ?? root["LibraryFolders"];
            if (folders is null) return libs;
            foreach (var (key, node) in folders.Children)
            {
                // New format: "0" { "path" "…" }. Old format: "1" "D:\\SteamLibrary".
                var path = node.Value ?? node.Str("path");
                if (path is null || !key.All(char.IsDigit)) continue;
                var norm = PathUtil.Normalize(path);
                if (!libs.Any(l => PathUtil.Key(l) == PathUtil.Key(norm))) libs.Add(norm);
            }
        }
        catch (Exception e) when (e is IOException or FormatException or UnauthorizedAccessException)
        {
            error = "libraryfolders.vdf couldn't be read; only the main library was checked";
        }
        return libs;
    }

    internal static InstallRecord? ReadManifest(string acfPath, string steamapps)
    {
        var state = VdfParser.ParseFile(acfPath)["AppState"];
        if (state is null) return null;
        var appId = state.Str("appid");
        var name = state.Str("name");
        var installDir = state.Str("installdir");
        if (appId is null || installDir is null) return null;
        if (NonGameAppIds.Contains(appId)) return null;
        if (name is not null && IsToolName(name)) return null;

        var path = Path.Combine(steamapps, "common", installDir);
        var flags = state.Long("StateFlags") ?? 0;
        var exists = Directory.Exists(path);
        var record = new InstallRecord
        {
            Source = SourceKind.Steam,
            SourceKey = appId,
            Title = name ?? installDir,
            InstallPath = PathUtil.Normalize(path),
            LaunchUri = $"steam://rungameid/{appId}",
            UninstallCommand = $"steam://uninstall/{appId}",
            IsInstalled = exists,
        };
        var size = state.Long("SizeOnDisk");
        if (size is > 0)
        {
            record.SizeBytes = size;
            record.SizeSource = SizeSource.Manifest;
        }
        if ((flags & 4) == 0) record.Signals.Add("Steam: download or update not finished");
        var lastPlayed = state.Long("LastPlayed");
        if (lastPlayed is > 0) record.ImportedLastPlayed = DateTimeOffset.FromUnixTimeSeconds(lastPlayed.Value);
        return record;
    }

    private static bool IsToolName(string name) =>
        name.StartsWith("Proton ", StringComparison.OrdinalIgnoreCase)
        || name.StartsWith("Steam Linux Runtime", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Redistributable", StringComparison.OrdinalIgnoreCase)
        || name.EndsWith("Dedicated Server", StringComparison.OrdinalIgnoreCase);

    /// <summary>Steam playtime (minutes) per appid, summed across every Steam account that has used this PC.</summary>
    internal static Dictionary<string, (long Minutes, long LastPlayed)> ReadPlaytime(string steamPath)
    {
        var result = new Dictionary<string, (long, long)>();
        var userdata = Path.Combine(steamPath, "userdata");
        if (!Directory.Exists(userdata)) return result;
        foreach (var user in Directory.EnumerateDirectories(userdata))
        {
            var file = Path.Combine(user, "config", "localconfig.vdf");
            if (!File.Exists(file)) continue;
            try
            {
                var apps = VdfParser.ParseFile(file).Path("UserLocalConfigStore", "Software", "Valve", "Steam", "apps");
                if (apps is null) continue;
                foreach (var (appId, node) in apps.Children)
                {
                    var minutes = node.Long("Playtime") ?? 0;
                    var last = node.Long("LastPlayed") ?? 0;
                    if (minutes == 0 && last == 0) continue;
                    result.TryGetValue(appId, out var prev);
                    result[appId] = (prev.Item1 + minutes, Math.Max(prev.Item2, last));
                }
            }
            catch (Exception e) when (e is IOException or FormatException or UnauthorizedAccessException)
            {
                // Steam rewrites this file while running; a failed read just means no imported hours this time.
            }
        }
        return result;
    }

    private static void ApplyPlaytime(string steamPath, List<InstallRecord> installs)
    {
        var playtime = ReadPlaytime(steamPath);
        foreach (var r in installs)
        {
            if (r.SourceKey is null || !playtime.TryGetValue(r.SourceKey, out var p)) continue;
            r.ImportedPlaySeconds = p.Minutes * 60;
            if (p.LastPlayed > 0)
            {
                var last = DateTimeOffset.FromUnixTimeSeconds(p.LastPlayed);
                if (r.ImportedLastPlayed is null || last > r.ImportedLastPlayed) r.ImportedLastPlayed = last;
            }
        }
    }
}
