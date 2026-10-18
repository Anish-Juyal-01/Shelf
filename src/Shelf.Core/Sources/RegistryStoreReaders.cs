using System.Xml.Linq;
using Shelf.Core.Model;
using Shelf.Core.Platform;

namespace Shelf.Core.Sources;

/// <summary>GOG: <c>HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\&lt;id&gt;</c>. GOG games run fine without Galaxy, so they launch directly.</summary>
public sealed class GogReader : ISourceReader
{
    private const string Root = @"HKLM\SOFTWARE\WOW6432Node\GOG.com\Games";

    public SourceKind Kind => SourceKind.Gog;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var ids = ctx.Registry.GetSubKeyNames(Root);
        if (ids.Count == 0) return SourceResult.NotInstalled(Kind, "No GOG games registered on this PC");

        var installs = new List<InstallRecord>();
        foreach (var id in ids)
        {
            var key = Root + "\\" + id;
            var path = ctx.Registry.GetValue(key, "path");
            if (string.IsNullOrWhiteSpace(path)) continue;
            // DLC entries name the game they belong to.
            if (!string.IsNullOrWhiteSpace(ctx.Registry.GetValue(key, "dependsOn"))) continue;
            var dir = PathUtil.Normalize(path);
            var exe = ctx.Registry.GetValue(key, "exe");
            var record = new InstallRecord
            {
                Source = Kind,
                SourceKey = id,
                Title = ctx.Registry.GetValue(key, "gameName") ?? ctx.Registry.GetValue(key, "GAMENAME") ?? Path.GetFileName(dir),
                InstallPath = dir,
                LaunchExe = string.IsNullOrWhiteSpace(exe) ? null : PathUtil.Normalize(exe),
                LaunchArgs = NullIfEmpty(ctx.Registry.GetValue(key, "launchParam")),
                WorkingDir = NullIfEmpty(ctx.Registry.GetValue(key, "workingDir")),
                IsInstalled = Directory.Exists(dir),
            };
            if (record.LaunchExe is not null) record.PlayExes.Add(record.LaunchExe);
            installs.Add(record);
        }
        return new SourceResult(Kind, SourceState.Ok, SourceReaders.Plural(installs.Count, "game"), installs);
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}

/// <summary>
/// EA app: its own install database is encrypted, so games are found from EA's registry keys and from folders
/// under the default EA library that carry <c>__Installer\installerdata.xml</c>.
/// </summary>
public sealed class EaReader : ISourceReader
{
    private static readonly string[] Roots =
    [
        @"HKLM\SOFTWARE\WOW6432Node\Electronic Arts",
        @"HKLM\SOFTWARE\Electronic Arts",
        @"HKLM\SOFTWARE\WOW6432Node\EA Games",
        @"HKLM\SOFTWARE\EA Games",
    ];

    private static readonly HashSet<string> NotGames = new(StringComparer.OrdinalIgnoreCase)
        { "EA Core", "EA Desktop", "EADM", "Origin", "EA app", "EA Desktop Launcher" };

    public SourceKind Kind => SourceKind.Ea;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var appInstalled = Roots.Any(r => ctx.Registry.GetSubKeyNames(r).Any(n => NotGames.Contains(n)))
            || Directory.Exists(Path.Combine(ctx.ProgramFiles, "Electronic Arts", "EA Desktop"));
        var installs = new List<InstallRecord>();
        var seen = new HashSet<string>();

        foreach (var root in Roots)
        {
            foreach (var name in ctx.Registry.GetSubKeyNames(root))
            {
                if (NotGames.Contains(name)) continue;
                var key = root + "\\" + name;
                var dir = ctx.Registry.GetValue(key, "Install Dir") ?? ctx.Registry.GetValue(key, "InstallDir");
                if (string.IsNullOrWhiteSpace(dir)) continue;
                var path = PathUtil.Normalize(dir);
                if (!seen.Add(PathUtil.Key(path))) continue;
                installs.Add(new InstallRecord
                {
                    Source = Kind,
                    SourceKey = name,
                    Title = ctx.Registry.GetValue(key, "DisplayName") ?? name,
                    InstallPath = path,
                    IsInstalled = Directory.Exists(path),
                });
            }
        }

        foreach (var library in new[] { Path.Combine(ctx.ProgramFiles, "EA Games"), Path.Combine(ctx.ProgramFilesX86, "Origin Games") })
        {
            if (!Directory.Exists(library)) continue;
            foreach (var dir in SafeDirs(library))
            {
                var xml = Path.Combine(dir, "__Installer", "installerdata.xml");
                if (!File.Exists(xml) || !seen.Add(PathUtil.Key(dir))) continue;
                installs.Add(new InstallRecord
                {
                    Source = Kind,
                    Title = ReadInstallerTitle(xml) ?? Path.GetFileName(dir),
                    InstallPath = PathUtil.Normalize(dir),
                });
            }
        }

        if (!appInstalled && installs.Count == 0) return SourceResult.NotInstalled(Kind, "EA app isn't installed");
        // EA's own database is encrypted, so coverage relies on registry keys and the default library folder.
        // Anything they miss still shows up through Windows' installed apps or the folder scanner.
        return new SourceResult(Kind, SourceState.Ok,
            $"{SourceReaders.Plural(installs.Count, "game")} (via registry and the EA Games folder; EA's own database is encrypted)",
            installs);
    }

    internal static string? ReadInstallerTitle(string xmlPath)
    {
        try
        {
            var doc = XDocument.Load(xmlPath);
            var titles = doc.Descendants().Where(e => e.Name.LocalName == "gameTitle").ToList();
            var en = titles.FirstOrDefault(t => (string?)t.Attribute("locale") is "en_US" or "en_GB") ?? titles.FirstOrDefault();
            var value = en?.Value.Trim();
            return string.IsNullOrEmpty(value) ? null : value;
        }
        catch (Exception e) when (e is IOException or System.Xml.XmlException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    internal static IEnumerable<string> SafeDirs(string path)
    {
        try { return Directory.GetDirectories(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
    }
}

/// <summary>Ubisoft Connect: <c>HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\&lt;id&gt;</c>.</summary>
public sealed class UbisoftReader : ISourceReader
{
    private const string Launcher = @"HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher";

    public SourceKind Kind => SourceKind.Ubisoft;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var ids = ctx.Registry.GetSubKeyNames(Launcher + @"\Installs");
        if (ids.Count == 0 && ctx.Registry.GetValue(Launcher, "InstallDir") is null)
            return SourceResult.NotInstalled(Kind, "Ubisoft Connect isn't installed");

        var installs = new List<InstallRecord>();
        foreach (var id in ids)
        {
            var dir = ctx.Registry.GetValue($@"{Launcher}\Installs\{id}", "InstallDir");
            if (string.IsNullOrWhiteSpace(dir)) continue;
            var path = PathUtil.Normalize(dir);
            installs.Add(new InstallRecord
            {
                Source = Kind,
                SourceKey = id,
                Title = Naming.NameCleaner.Clean(Path.GetFileName(path)),
                InstallPath = path,
                LaunchUri = $"uplay://launch/{id}/0",
                UninstallCommand = $"uplay://uninstall/{id}",
                IsInstalled = Directory.Exists(path),
            });
        }
        return new SourceResult(Kind, SourceState.Ok,
            installs.Count == 0 ? "Ubisoft Connect found, no games installed" : SourceReaders.Plural(installs.Count, "game"), installs);
    }
}

/// <summary>Rockstar Games Launcher: <c>HKLM\SOFTWARE\WOW6432Node\Rockstar Games\&lt;title&gt;</c> → InstallFolder.</summary>
public sealed class RockstarReader : ISourceReader
{
    private const string Root = @"HKLM\SOFTWARE\WOW6432Node\Rockstar Games";

    private static readonly HashSet<string> NotGames = new(StringComparer.OrdinalIgnoreCase)
        { "Launcher", "Rockstar Games Launcher", "Rockstar Games Social Club", "Social Club" };

    public SourceKind Kind => SourceKind.Rockstar;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var names = ctx.Registry.GetSubKeyNames(Root);
        if (names.Count == 0) return SourceResult.NotInstalled(Kind, "Rockstar Games Launcher isn't installed");

        var installs = new List<InstallRecord>();
        foreach (var name in names)
        {
            if (NotGames.Contains(name)) continue;
            var dir = ctx.Registry.GetValue(Root + "\\" + name, "InstallFolder");
            if (string.IsNullOrWhiteSpace(dir)) continue;
            var path = PathUtil.Normalize(dir);
            installs.Add(new InstallRecord
            {
                Source = Kind,
                SourceKey = name,
                Title = name,
                InstallPath = path,
                IsInstalled = Directory.Exists(path),
            });
        }
        return new SourceResult(Kind, SourceState.Ok, SourceReaders.Plural(installs.Count, "game"), installs);
    }
}

/// <summary>Battle.net: the agent's product.db is protobuf, so games come from Blizzard's Uninstall entries.</summary>
public sealed class BattleNetReader : ISourceReader
{
    public SourceKind Kind => SourceKind.BattleNet;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var installed = Directory.Exists(Path.Combine(ctx.ProgramFilesX86, "Battle.net"))
            || Directory.Exists(Path.Combine(ctx.ProgramData, "Battle.net"));
        var installs = new List<InstallRecord>();
        foreach (var e in UninstallEntries.Read(ctx.Registry))
        {
            var isBlizzard = (e.UninstallString?.Contains("Battle.net", StringComparison.OrdinalIgnoreCase) ?? false)
                || string.Equals(e.Publisher, "Blizzard Entertainment", StringComparison.OrdinalIgnoreCase);
            if (!isBlizzard || e.DisplayName.StartsWith("Battle.net", StringComparison.OrdinalIgnoreCase)) continue;
            var location = e.ResolvedLocation;
            if (location is null) continue;
            installs.Add(new InstallRecord
            {
                Source = Kind,
                SourceKey = e.KeyName,
                Title = e.DisplayName,
                InstallPath = location,
                UninstallCommand = e.UninstallString,
                IsInstalled = Directory.Exists(location),
            });
        }
        if (!installed && installs.Count == 0) return SourceResult.NotInstalled(Kind, "Battle.net isn't installed");
        return new SourceResult(Kind, SourceState.Ok, SourceReaders.Plural(installs.Count, "game") + " (from Windows' installed apps)", installs);
    }
}

/// <summary>Riot Client: "Riot Game &lt;product&gt;.&lt;patchline&gt;" Uninstall entries, launched through RiotClientServices.</summary>
public sealed class RiotReader : ISourceReader
{
    public SourceKind Kind => SourceKind.Riot;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var clientJson = Path.Combine(ctx.ProgramData, "Riot Games", "RiotClientInstalls.json");
        string? client = null;
        if (File.Exists(clientJson))
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(clientJson));
                if (doc.RootElement.TryGetProperty("rc_default", out var rc)) client = rc.GetString();
            }
            catch (Exception e) when (e is IOException or System.Text.Json.JsonException or UnauthorizedAccessException) { }
        }

        var installs = new List<InstallRecord>();
        foreach (var e in UninstallEntries.Read(ctx.Registry))
        {
            if (!e.KeyName.StartsWith("Riot Game ", StringComparison.OrdinalIgnoreCase)) continue;
            var id = e.KeyName["Riot Game ".Length..].Trim();
            var dot = id.IndexOf('.');
            var product = dot > 0 ? id[..dot] : id;
            var patchline = dot > 0 ? id[(dot + 1)..] : "live";
            if (product.Length == 0 || product.Equals("Riot_Client", StringComparison.OrdinalIgnoreCase)) continue;
            var location = e.ResolvedLocation;
            if (location is null) continue;
            var record = new InstallRecord
            {
                Source = Kind,
                SourceKey = id,
                Title = e.DisplayName,
                InstallPath = location,
                UninstallCommand = e.UninstallString,
                IsInstalled = Directory.Exists(location),
            };
            if (client is not null)
            {
                record.LaunchExe = PathUtil.Normalize(client);
                record.LaunchArgs = $"--launch-product={product} --launch-patchline={patchline}";
            }
            installs.Add(record);
        }
        if (client is null && installs.Count == 0) return SourceResult.NotInstalled(Kind, "Riot Client isn't installed");
        return new SourceResult(Kind, SourceState.Ok, SourceReaders.Plural(installs.Count, "game"), installs);
    }
}

/// <summary>HoYoPlay (Genshin Impact, Honkai: Star Rail, Zenless Zone Zero…): per-game keys under HKCU.</summary>
public sealed class HoYoPlayReader : ISourceReader
{
    private static readonly string[] Roots = [@"HKCU\Software\Cognosphere\HYP\1_0", @"HKCU\Software\miHoYo\HYP\1_0"];

    private static readonly Dictionary<string, string> Titles = new(StringComparer.OrdinalIgnoreCase)
    {
        ["hk4e"] = "Genshin Impact",
        ["hkrpg"] = "Honkai: Star Rail",
        ["nap"] = "Zenless Zone Zero",
        ["bh3"] = "Honkai Impact 3rd",
    };

    public SourceKind Kind => SourceKind.HoYoPlay;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var launcherFound = false;
        var installs = new List<InstallRecord>();
        foreach (var root in Roots)
        {
            if (ctx.Registry.GetValue(root, "InstallPath") is not null) launcherFound = true;
            foreach (var biz in ctx.Registry.GetSubKeyNames(root))
            {
                launcherFound = true;
                var dir = ctx.Registry.GetValue(root + "\\" + biz, "GameInstallPath");
                if (string.IsNullOrWhiteSpace(dir)) continue;
                var path = PathUtil.Normalize(dir);
                var prefix = biz.Split('_')[0];
                installs.Add(new InstallRecord
                {
                    Source = Kind,
                    SourceKey = biz,
                    Title = Titles.GetValueOrDefault(prefix) ?? Naming.NameCleaner.Clean(Path.GetFileName(path)),
                    InstallPath = path,
                    IsInstalled = Directory.Exists(path),
                });
            }
        }
        if (!launcherFound) return SourceResult.NotInstalled(Kind, "HoYoPlay isn't installed");
        return new SourceResult(Kind, SourceState.Ok,
            installs.Count == 0 ? "HoYoPlay found, no games installed" : SourceReaders.Plural(installs.Count, "game"), installs);
    }
}
