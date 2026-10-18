using Shelf.Core.Model;
using Shelf.Core.Platform;

namespace Shelf.Core.Sources;

/// <summary>
/// Reads one launcher's local install data. Readers only ever read files and registry keys; they never log in,
/// call store APIs or touch game folders beyond checking they exist.
/// </summary>
public interface ISourceReader
{
    SourceKind Kind { get; }

    SourceResult Read(SystemContext ctx, CancellationToken ct = default);
}

public static class SourceReaders
{
    public static IReadOnlyList<ISourceReader> All() =>
    [
        new SteamReader(),
        new EpicReader(),
        new GogReader(),
        new EaReader(),
        new UbisoftReader(),
        new RockstarReader(),
        new XboxReader(),
        new BattleNetReader(),
        new ItchReader(),
        new AmazonReader(),
        new RiotReader(),
        new HoYoPlayReader(),
        new InstalledAppsReader(),
    ];

    /// <summary>Runs every reader; a reader that throws is reported as unreadable instead of breaking the rest.</summary>
    public static List<SourceResult> ReadAll(SystemContext ctx, CancellationToken ct = default)
    {
        var readers = All();
        var results = new SourceResult[readers.Count];
        Parallel.For(0, readers.Count, new ParallelOptions { CancellationToken = ct }, i =>
        {
            try { results[i] = readers[i].Read(ctx, ct); }
            catch (OperationCanceledException) { throw; }
            catch (Exception e) { results[i] = SourceResult.Unreadable(readers[i].Kind, $"Couldn't read: {e.Message}"); }
        });
        return [.. results];
    }

    internal static string Plural(int n, string word) => n == 1 ? $"1 {word}" : $"{n} {word}s";
}
