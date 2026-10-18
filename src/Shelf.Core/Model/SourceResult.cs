namespace Shelf.Core.Model;

public enum SourceState
{
    /// <summary>Read fine (possibly zero games).</summary>
    Ok,
    /// <summary>The launcher isn't on this PC.</summary>
    NotInstalled,
    /// <summary>Some data read, some couldn't be (missing library drive, unreadable manifest, registry-only fallback).</summary>
    Partial,
    /// <summary>The launcher is here but its data couldn't be read at all.</summary>
    Unreadable,
}

/// <summary>What one store reader found, plus an honest sentence for the UI.</summary>
public sealed record SourceResult(SourceKind Source, SourceState State, string Message, IReadOnlyList<InstallRecord> Installs)
{
    public static SourceResult NotInstalled(SourceKind source, string message) => new(source, SourceState.NotInstalled, message, []);

    public static SourceResult Unreadable(SourceKind source, string message) => new(source, SourceState.Unreadable, message, []);
}
