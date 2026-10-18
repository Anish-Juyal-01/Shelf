namespace Shelf.Core.Model;

public enum SizeSource
{
    Unknown,
    /// <summary>Reported by the launcher (Steam SizeOnDisk, Epic InstallSize).</summary>
    Manifest,
    /// <summary>Shelf added up the files itself.</summary>
    Measured,
}

/// <summary>One copy of a game on disk, as reported by one source.</summary>
public sealed class InstallRecord
{
    public required SourceKind Source { get; init; }

    /// <summary>The source's own id: Steam appid, Epic AppName, GOG id, uninstall key name…</summary>
    public string? SourceKey { get; init; }

    public required string Title { get; set; }

    public required string InstallPath { get; init; }

    /// <summary>Exe to start for local launching (also the main exe for playtime).</summary>
    public string? LaunchExe { get; set; }

    /// <summary>Store URI that launches the game through its launcher, when there is one.</summary>
    public string? LaunchUri { get; set; }

    public string? LaunchArgs { get; set; }

    public string? WorkingDir { get; set; }

    /// <summary>Store URI or command that runs the launcher's own uninstaller. Shelf never deletes files itself.</summary>
    public string? UninstallCommand { get; set; }

    public long? SizeBytes { get; set; }

    public SizeSource SizeSource { get; set; }

    /// <summary>False when a launcher or Windows still lists the game but its folder is gone.</summary>
    public bool IsInstalled { get; init; } = true;

    /// <summary>0–100. Store installs are 100; detections are scored by <see cref="Scanning.FolderClassifier"/>.</summary>
    public int Confidence { get; set; } = 100;

    /// <summary>Every exe that counts as playing this game (launcher exe, *-Shipping.exe…).</summary>
    public List<string> PlayExes { get; init; } = [];

    /// <summary>Human-readable reasons for the confidence score.</summary>
    public List<string> Signals { get; init; } = [];

    /// <summary>Playtime recorded by the launcher before Shelf (Steam's own counter).</summary>
    public long ImportedPlaySeconds { get; set; }

    public DateTimeOffset? ImportedLastPlayed { get; set; }
}
