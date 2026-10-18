using System.Text.Json;
using Shelf.Core.Model;
using Shelf.Core.Platform;

namespace Shelf.Core.Sources;

/// <summary>Epic Games Launcher: one JSON <c>*.item</c> manifest per installed app.</summary>
public sealed class EpicReader : ISourceReader
{
    public SourceKind Kind => SourceKind.Epic;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var dataPath = ctx.Registry.GetValue(@"HKLM\SOFTWARE\WOW6432Node\Epic Games\EpicGamesLauncher", "AppDataPath");
        var manifests = !string.IsNullOrWhiteSpace(dataPath)
            ? Path.Combine(dataPath, "Manifests")
            : Path.Combine(ctx.ProgramData, "Epic", "EpicGamesLauncher", "Data", "Manifests");

        if (!Directory.Exists(manifests))
        {
            var launcherInstalled = Directory.Exists(Path.Combine(ctx.ProgramData, "Epic", "EpicGamesLauncher"))
                || Directory.Exists(Path.Combine(ctx.ProgramFilesX86, "Epic Games", "Launcher"))
                || Directory.Exists(Path.Combine(ctx.ProgramFiles, "Epic Games", "Launcher"));
            return launcherInstalled
                ? SourceResult.Unreadable(Kind, $"Epic is installed but its manifests folder wasn't found ({manifests})")
                : SourceResult.NotInstalled(Kind, "Epic Games Launcher isn't installed");
        }

        var installs = new List<InstallRecord>();
        var bad = 0;
        foreach (var file in Directory.EnumerateFiles(manifests, "*.item"))
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var r = ReadItem(File.ReadAllText(file));
                if (r is not null) installs.Add(r);
            }
            catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException or InvalidOperationException)
            {
                bad++;
            }
        }

        var msg = installs.Count == 0 && bad == 0
            ? "Epic Games Launcher found, no games installed"
            : SourceReaders.Plural(installs.Count, "game");
        return bad == 0
            ? new SourceResult(Kind, SourceState.Ok, msg, installs)
            : new SourceResult(Kind, SourceState.Partial, $"{msg} · {SourceReaders.Plural(bad, "manifest")} couldn't be read", installs);
    }

    internal static InstallRecord? ReadItem(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var r = doc.RootElement;
        string? S(string name) => r.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        var appName = S("AppName");
        var location = S("InstallLocation");
        if (appName is null || string.IsNullOrWhiteSpace(location)) return null;
        if (r.TryGetProperty("bIsIncompleteInstall", out var inc) && inc.ValueKind == JsonValueKind.True) return null;

        // DLC and add-ons have their own manifests pointing at the base game's folder.
        var main = S("MainGameAppName");
        if (main is not null && !string.Equals(main, appName, StringComparison.OrdinalIgnoreCase)) return null;
        if (r.TryGetProperty("AppCategories", out var cats) && cats.ValueKind == JsonValueKind.Array)
        {
            var categories = cats.EnumerateArray().Select(c => c.GetString() ?? "").ToList();
            if (categories.Count > 0 && !categories.Contains("games", StringComparer.OrdinalIgnoreCase)) return null;
        }

        var path = PathUtil.Normalize(location);
        var exe = S("LaunchExecutable");
        var record = new InstallRecord
        {
            Source = SourceKind.Epic,
            SourceKey = appName,
            Title = S("DisplayName") ?? appName,
            InstallPath = path,
            LaunchExe = string.IsNullOrEmpty(exe) ? null : Path.Combine(path, exe),
            IsInstalled = Directory.Exists(path),
        };
        var ns = S("CatalogNamespace");
        var item = S("CatalogItemId");
        if (ns is not null && item is not null)
        {
            record.LaunchUri = $"com.epicgames.launcher://apps/{ns}%3A{item}%3A{appName}?action=launch&silent=true";
            record.UninstallCommand = $"com.epicgames.launcher://apps/{ns}%3A{item}%3A{appName}?action=uninstall";
        }
        if (r.TryGetProperty("InstallSize", out var size) && size.TryGetInt64(out var bytes) && bytes > 0)
        {
            record.SizeBytes = bytes;
            record.SizeSource = SizeSource.Manifest;
        }
        if (record.LaunchExe is not null) record.PlayExes.Add(record.LaunchExe);
        return record;
    }
}
