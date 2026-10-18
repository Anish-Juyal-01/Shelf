using System.Text.RegularExpressions;
using Shelf.Core.Naming;
using Shelf.Core.Platform;

namespace Shelf.Core.Scanning;

public enum VerdictKind
{
    None,
    Game,
    /// <summary>A downloaded installer or repack that hasn't been installed (setup.exe + big .bin files). Storage leftover.</summary>
    Installer,
}

public sealed class FolderVerdict
{
    public VerdictKind Kind { get; set; }
    public int Score { get; set; }
    public List<string> Signals { get; init; } = [];
    public string? Title { get; set; }
    public string? LaunchExe { get; set; }
    public List<string> PlayExes { get; init; } = [];

    /// <summary>Bytes seen while classifying (the folder's files plus one level down). A lower bound of the real size.</summary>
    public long SeenBytes { get; set; }

    public static readonly FolderVerdict NotAGame = new() { Kind = VerdictKind.None };
}

public sealed class ClassifierOptions
{
    /// <summary>Game-data archives (.pak, .bundle…) at least this big count as a strong signal.</summary>
    public long LargeDataBytes { get; init; } = 200 * Bytes.MB;

    /// <summary>Scores at or above this go straight to the library.</summary>
    public int LibraryThreshold { get; init; } = 70;

    /// <summary>Scores between this and <see cref="LibraryThreshold"/> go to the Review list; below are dropped.</summary>
    public int ReviewThreshold { get; init; } = 35;

    /// <summary>How many subfolders to peek into when adding up data sizes.</summary>
    public int MaxPeekDirs { get; init; } = 16;

    public static readonly ClassifierOptions Default = new();
}

/// <summary>
/// Decides whether a folder is a game root, from its own files and one level of subfolders. Every point added or
/// taken away is recorded as a human-readable signal so the Review list can explain itself.
/// </summary>
public static partial class FolderClassifier
{
    private static readonly HashSet<string> ArchiveExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pak", ".ucas", ".utoc", ".bundle", ".assets", ".ress", ".resource", ".arc", ".pck", ".rpa", ".rpyc", ".vpk", ".wad",
        ".forge", ".rpf", ".big", ".cpk", ".bdt", ".bhd", ".archive", ".xp3", ".gcf", ".bsa", ".ba2", ".esm", ".wpk",
        ".bk2", ".bik", ".usm", ".awb", ".acb", ".fsb", ".bnk", ".wem", ".xwb", ".pkg", ".sga", ".dat0", ".rgssad",
        ".rgss2a", ".rgss3a", ".obb", ".cache", ".tiger", ".toc", ".sb", ".cas", ".dz", ".mpk", ".gpk", ".upk", ".u", ".umap",
    };

    private static readonly string[] Middleware =
    [
        "fmod", "fmodex", "fmodstudio", "bink2w64", "binkw32", "binkw64", "physx", "amd_ags", "nvngx_dlss", "xinput1_3",
        "d3dx9_", "openal32", "ffx_fsr", "discord_game_sdk", "sl.interposer", "oo2core", "oo2net",
        "wwise", "aksoundengine", "libfmod", "sdl2", "gameoverlayrenderer", "nvlowlatency",
        "gfsdk_", "phonon", "criware", "cri_", "mono-2.0", "havok",
    ];

    private static readonly string[] ExeSubfolders =
    [
        "bin", "bin64", @"bin\x64", @"bin\win64", @"bin\win_x64", "x64", "win64", @"binaries\win64", "game", @"game\bin\win64",
    ];

    private static readonly HashSet<string> GenericFolderNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "bin", "bin64", "x64", "x86", "win64", "win32", "binaries", "release", "content", "app", "files", "game", "data",
        "common", "build", "windows", "windowsnoeditor", "pc", "live",
    };

    public static FolderVerdict Evaluate(string path, ClassifierOptions? options = null)
    {
        var listing = DirListing.TryRead(path);
        return listing is null ? FolderVerdict.NotAGame : Evaluate(listing, options);
    }

    public static FolderVerdict Evaluate(DirListing root, ClassifierOptions? options = null)
    {
        options ??= ClassifierOptions.Default;

        // Folders that hold this folder's exes: itself plus common layouts (bin\x64, Binaries\Win64…).
        var exeDirs = new List<DirListing> { root };
        foreach (var sub in ExeSubfolders)
        {
            var first = sub.Split('\\')[0];
            if (!root.HasDir(first)) continue;
            var listing = DirListing.TryRead(Path.Combine(root.Path, sub));
            if (listing is not null && listing.Files.Any(f => ExeClassifier.IsExe(f.Name))) exeDirs.Add(listing);
        }

        var allExes = exeDirs
            .SelectMany(d => d.Files.Where(f => ExeClassifier.IsExe(f.Name)).Select(f => (Dir: d, File: f)))
            .ToList();
        var exes = allExes.Where(e => !ExeClassifier.IsNoise(e.File.Name)).ToList();

        var v = new FolderVerdict();
        if (exes.Count == 0)
        {
            return IsInstaller(root, allExes.Select(e => e.File.Name).ToList(), v) ? v : FolderVerdict.NotAGame;
        }

        var files = exeDirs.SelectMany(d => d.Files).ToList();
        bool Has(string name) => files.Any(f => f.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
        void Add(int points, string why)
        {
            v.Score += points;
            v.Signals.Add(points >= 0 ? $"+{points} {why}" : $"{points} {why}");
        }

        // Peek one level down for data sizes (Unity *_Data, Data*.bdt folders, Content\Paks…).
        var peeked = new List<DirListing>();
        foreach (var d in root.Dirs.Take(options.MaxPeekDirs))
        {
            if (d.Name.Equals("locales", StringComparison.OrdinalIgnoreCase)) continue;
            var l = DirListing.TryRead(Path.Combine(root.Path, d.Name));
            if (l is not null) peeked.Add(l);
        }
        var nearby = root.Files.Concat(peeked.SelectMany(p => p.Files)).ToList();
        v.SeenBytes = nearby.Sum(f => f.Length);

        // --- Engines ---------------------------------------------------------------------------------------
        if (Has("UnityPlayer.dll")) Add(45, "Unity engine (UnityPlayer.dll)");
        if (Has("GameAssembly.dll")) Add(10, "IL2CPP build (GameAssembly.dll)");
        if (exes.Any(e => e.Dir.HasDir(ExeClassifier.Stem(e.File.Name) + "_Data"))) Add(20, "Unity data folder (<exe>_Data)");

        var shipping = FindShippingExes(root, out var paks);
        nearby.AddRange(paks);
        if (shipping.Count > 0 || exes.Any(e => e.File.Name.Contains("-Shipping", StringComparison.OrdinalIgnoreCase)))
            Add(45, "Unreal shipping build (*-Shipping.exe)");
        else if (root.HasDir("Engine")) Add(25, "Unreal/CryEngine layout (Engine folder)");

        if (exes.Any(e => e.Dir.HasFile(ExeClassifier.Stem(e.File.Name) + ".pck"))) Add(45, "Godot game (.pck beside exe)");
        if (Has("data.win")) Add(45, "GameMaker game (data.win)");
        if (root.HasDir("renpy")) Add(45, "Ren'Py game");
        if (files.Any(f => f.Name.StartsWith("Game.rgss", StringComparison.OrdinalIgnoreCase)) || Has("RGSS301.dll") || Has("RGSS104E.dll")
            || (root.HasDir("www") && Has("nw.dll")))
            Add(40, "RPG Maker game");
        if (Has("MonoGame.Framework.dll") || Has("FNA.dll") || files.Any(f => f.Name.StartsWith("Microsoft.Xna.Framework", StringComparison.OrdinalIgnoreCase)))
            Add(40, "XNA/MonoGame/FNA game");
        if (Has("love.dll")) Add(35, "LÖVE game");
        if (nearby.Any(f => f.Name.EndsWith(".vpk", StringComparison.OrdinalIgnoreCase)) || root.HasDir("bin") && DirListing.TryRead(Path.Combine(root.Path, "bin"))?.HasFile("engine.dll") == true)
            Add(35, "Source engine game");

        // --- Store / DRM fingerprints ----------------------------------------------------------------------
        if (Has("steam_api64.dll") || Has("steam_api.dll")) Add(25, "Steamworks (steam_api)");
        if (Has("steam_emu.ini") || Has("steam_appid.txt") || Has("cream_api.ini") || files.Any(f => f.Name.EndsWith(".cdx", StringComparison.OrdinalIgnoreCase)))
            Add(10, "Steam emulator / app id file");
        if (files.Any(f => f.Name.StartsWith("goggame-", StringComparison.OrdinalIgnoreCase)) || root.Files.Any(f => f.Name.StartsWith("goggame-", StringComparison.OrdinalIgnoreCase)))
            Add(30, "GOG game (goggame-*.info)");
        if (Has("EOSSDK-Win64-Shipping.dll") || Has("EOSSDK-Win32-Shipping.dll")) Add(15, "Epic Online Services SDK");
        if (Has("uplay_r1_loader64.dll") || Has("upc_r2_loader64.dll") || Has("uplay_r2_loader64.dll")) Add(25, "Ubisoft Connect SDK");

        var middleware = files.Count(f => f.Name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
            && Middleware.Any(m => f.Name.StartsWith(m, StringComparison.OrdinalIgnoreCase)));
        if (middleware > 0) Add(Math.Min(25, middleware * 10), $"Game middleware ({middleware} libraries: audio, video, physics, upscaling…)");

        if (exes.Any(e => ExeClassifier.IsKnownGame(e.File.Name))) Add(60, "Known game exe");

        // --- Data size --------------------------------------------------------------------------------------
        var archiveBytes = nearby.Where(f => IsGameArchive(f.Name)).Sum(f => f.Length);
        if (archiveBytes >= options.LargeDataBytes * 10) Add(35, $"Large game data files ({Bytes.Format(archiveBytes)})");
        else if (archiveBytes >= options.LargeDataBytes) Add(25, $"Game data files ({Bytes.Format(archiveBytes)})");
        else if (v.SeenBytes >= options.LargeDataBytes * 10) Add(20, $"Large folder beside the exe ({Bytes.Format(v.SeenBytes)}+)");
        else if (v.SeenBytes >= options.LargeDataBytes * 2.5) Add(15, $"Sizeable folder beside the exe ({Bytes.Format(v.SeenBytes)}+)");

        // --- Context ----------------------------------------------------------------------------------------
        if (InGamesFolder(root.Path)) Add(15, "Inside a Games folder");
        if (RepackName().IsMatch(Path.GetFileName(root.Path))) Add(15, "Repack/release name");

        // --- Things that aren't games -----------------------------------------------------------------------
        if (root.HasDir("resources") && (root.HasFile("chrome_100_percent.pak") || root.HasFile("v8_context_snapshot.bin")))
            Add(-60, "Electron app (Chromium runtime)");
        else if (Has("libcef.dll") && v.Score < options.LibraryThreshold) Add(-15, "Embedded browser (CEF)");
        if (Has("Qt5Core.dll") || Has("Qt6Core.dll")) Add(-15, "Qt desktop app");
        if (exes.Any(e => ExeClassifier.IsKnownApp(e.File.Name))) Add(-80, "Known non-game program");

        v.Score = Math.Clamp(v.Score, 0, 100);
        v.Kind = v.Score >= options.ReviewThreshold ? VerdictKind.Game : VerdictKind.None;

        PickExes(root, exes, shipping, v);
        v.Title = PickTitle(root.Path, v.LaunchExe);
        return v;
    }

    /// <summary>Unreal layout: <c>&lt;Game&gt;\Binaries\Win64\&lt;Game&gt;-Win64-Shipping.exe</c> beside an Engine folder.</summary>
    private static List<string> FindShippingExes(DirListing root, out List<FileEntry> paks)
    {
        var result = new List<string>();
        paks = [];
        if (!root.HasDir("Engine")) return result;
        foreach (var d in root.Dirs)
        {
            if (d.Name.Equals("Engine", StringComparison.OrdinalIgnoreCase)) continue;
            var bin = Path.Combine(root.Path, d.Name, "Binaries", "Win64");
            var l = DirListing.TryRead(bin);
            if (l is null) continue;
            result.AddRange(l.Files
                .Where(f => ExeClassifier.IsExe(f.Name) && f.Name.Contains("-Shipping", StringComparison.OrdinalIgnoreCase))
                .Select(f => Path.Combine(bin, f.Name)));
            // Unreal keeps its data two levels down: <Game>\Content\Paks.
            var pakDir = DirListing.TryRead(Path.Combine(root.Path, d.Name, "Content", "Paks"));
            if (pakDir is not null) paks.AddRange(pakDir.Files);
        }
        return result;
    }

    private static void PickExes(DirListing root, List<(DirListing Dir, FileEntry File)> exes, List<string> shipping, FolderVerdict v)
    {
        var folderKey = NameCleaner.Key(Path.GetFileName(root.Path));
        var largest = exes.Max(e => e.File.Length);
        var ranked = exes
            .Select(e =>
            {
                var stem = ExeClassifier.Stem(e.File.Name);
                var key = NameCleaner.Key(stem);
                var score = 0;
                if (key.Length >= 3 && folderKey.Length >= 3 && (folderKey.StartsWith(key) || key.StartsWith(folderKey))) score += 4;
                if (e.Dir.HasDir(stem + "_Data")) score += 4;
                if (ReferenceEquals(e.Dir, root)) score += 2;
                if (e.File.Length == largest) score += 1;
                if (UnlikelyMain().IsMatch(stem)) score -= 3;
                if (ExeClassifier.IsKnownGame(e.File.Name)) score += 5;
                return (Path: Path.Combine(e.Dir.Path, e.File.Name), Score: score);
            })
            .OrderByDescending(x => x.Score)
            .ToList();
        v.LaunchExe = ranked[0].Path;
        v.PlayExes.AddRange(ranked.Select(r => r.Path));
        foreach (var s in shipping)
            if (!v.PlayExes.Contains(s, StringComparer.OrdinalIgnoreCase)) v.PlayExes.Add(s);
    }

    private static string PickTitle(string path, string? launchExe)
    {
        var folder = Path.GetFileName(path);
        if (HashName().IsMatch(folder) && launchExe is not null) return NameCleaner.Clean(Path.GetFileName(launchExe));
        if (GenericFolderNames.Contains(folder))
        {
            var parent = Path.GetFileName(Path.GetDirectoryName(path) ?? "");
            if (!string.IsNullOrEmpty(parent) && !GenericFolderNames.Contains(parent) && !IsGamesFolderName(parent))
                return NameCleaner.Clean(parent);
            if (launchExe is not null) return NameCleaner.Clean(Path.GetFileName(launchExe));
        }
        return NameCleaner.Clean(folder);
    }

    private static bool IsInstaller(DirListing root, List<string> allExeNames, FolderVerdict v)
    {
        var hasSetup = allExeNames.Any(n => SetupExe().IsMatch(ExeClassifier.Stem(n)));
        if (!hasSetup) return false;
        var payload = root.Files.Where(f => InstallerPayload().IsMatch(f.Name)).Sum(f => f.Length);
        var fitgirlMarkers = root.HasDir("MD5") || root.Files.Any(f => f.Name.StartsWith("fg-", StringComparison.OrdinalIgnoreCase));
        if (payload < 50 * Bytes.MB && !fitgirlMarkers) return false;
        v.Kind = VerdictKind.Installer;
        v.Score = 60;
        v.SeenBytes = root.Files.Sum(f => f.Length);
        v.Signals.Add($"Installer with {Bytes.Format(payload)} of packed data (not installed)");
        v.Title = NameCleaner.Clean(Path.GetFileName(root.Path));
        v.LaunchExe = Path.Combine(root.Path, allExeNames.First(n => SetupExe().IsMatch(ExeClassifier.Stem(n))));
        return true;
    }

    internal static bool IsGameArchive(string fileName)
    {
        var ext = Path.GetExtension(fileName);
        if (!ArchiveExtensions.Contains(ext)) return false;
        // Chromium/Electron/CEF ship .pak files too.
        if (fileName.StartsWith("chrome", StringComparison.OrdinalIgnoreCase)
            || fileName.Equals("resources.pak", StringComparison.OrdinalIgnoreCase)
            || fileName.StartsWith("cef", StringComparison.OrdinalIgnoreCase)
            || fileName.StartsWith("devtools", StringComparison.OrdinalIgnoreCase))
            return false;
        return true;
    }

    internal static bool InGamesFolder(string path)
    {
        var parts = PathUtil.Normalize(path).Split('\\', StringSplitOptions.RemoveEmptyEntries);
        // Ancestors only — the folder's own name doesn't count.
        return parts.Take(parts.Length - 1).Any(IsGamesFolderName);
    }

    internal static bool IsGamesFolderName(string name) => GamesFolder().IsMatch(name);

    [GeneratedRegex(@"^(my ?)?(games?|jeux|spiele|juegos|giochi|jogos|repacks?|steamlibrary|epic ?games|gog ?games|xboxgames)$", RegexOptions.IgnoreCase)]
    private static partial Regex GamesFolder();

    /// <summary>Hash or GUID folder names (launcher caches, Xbox content ids) say nothing about the game.</summary>
    [GeneratedRegex(@"^(\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?|[0-9a-f]{16,})$", RegexOptions.IgnoreCase)]
    private static partial Regex HashName();

    [GeneratedRegex(@"fitgirl|dodi|elamigos|repack|codex|empress|tenoke|rune|plaza|skidrow|gog|multi\d|v\d+\.\d", RegexOptions.IgnoreCase)]
    private static partial Regex RepackName();

    [GeneratedRegex(@"launcher|config|settings|editor|server|tool|benchmark|crash|report|setup|unins|modmanager|sdk|test", RegexOptions.IgnoreCase)]
    private static partial Regex UnlikelyMain();

    [GeneratedRegex(@"^(setup|install|installer)([-_ ].*)?$|.*[-_ ]setup$", RegexOptions.IgnoreCase)]
    private static partial Regex SetupExe();

    [GeneratedRegex(@"\.(bin|cab|dat|7z|zip|rar)$|^fg-\d+|^setup-\d+|^data\d*", RegexOptions.IgnoreCase)]
    private static partial Regex InstallerPayload();
}
