namespace Shelf.Core.Model;

/// <summary>One game in the library. Several installs mean several copies on disk.</summary>
public sealed class GameEntry
{
    public required string Title { get; set; }

    /// <summary>Normalised title used for de-duplication.</summary>
    public required string Key { get; init; }

    public List<InstallRecord> Installs { get; } = [];

    public InstallRecord Primary => Installs[0];

    public IEnumerable<SourceKind> Sources => Installs.Select(i => i.Source).Distinct();

    public long SizeBytes => Installs.Where(i => i.IsInstalled).Sum(i => i.SizeBytes ?? 0);

    public long ImportedPlaySeconds => Installs.Max(i => i.ImportedPlaySeconds);

    public DateTimeOffset? ImportedLastPlayed => Installs.Max(i => i.ImportedLastPlayed);

    public bool IsInstalled => Installs.Any(i => i.IsInstalled);

    /// <summary>More than one installed copy — usually wasted space.</summary>
    public bool HasDuplicates => Installs.Count(i => i.IsInstalled) > 1;
}
