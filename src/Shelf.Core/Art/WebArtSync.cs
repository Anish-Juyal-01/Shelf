using Shelf.Core.Model;
using Shelf.Core.Platform;
using Shelf.Core.Storage;

namespace Shelf.Core.Art;

/// <summary>
/// Fills the gaps in every installed game's art from the web (<see cref="WebArt"/>), never replacing what was found
/// on disk. Each game is looked up at most once a week, unless a SteamGridDB key has been added since; a network
/// failure isn't remembered, so it simply tries again next time.
/// </summary>
public sealed class WebArtSync(LibraryStore library, ArtCache cache, WebArt web, IClock clock)
{
    public static readonly TimeSpan RetryAfter = TimeSpan.FromDays(7);

    /// <summary>Pause between games, to stay polite to the services.</summary>
    public TimeSpan Pace { get; init; } = TimeSpan.FromMilliseconds(300);

    public sealed record Summary(int Looked, int Images, int Failed);

    public async Task<Summary> RunAsync(Action<string, IReadOnlyCollection<ArtKind>>? onGame, CancellationToken ct)
    {
        int looked = 0, images = 0, failed = 0;
        foreach (var g in library.Games(includeHidden: true).Where(g => g.Installed))
        {
            ct.ThrowIfCancellationRequested();
            var want = Enum.GetValues<ArtKind>().Where(k => !cache.Has(g.Id, k)).ToHashSet();
            if (want.Count == 0) continue;
            if (cache.WebMark(g.Id) is { } mark && clock.UtcNow - mark.Tried < RetryAfter && (mark.WithGrid || !web.HasSteamGridDb)) continue;

            var appId = library.InstallsFor(g.Id)
                .Where(i => i.Source == SourceKind.Steam && i.LaunchUri is not null)
                .Select(i => i.LaunchUri!.Split('/').Last())
                .FirstOrDefault(id => id.Length > 0 && id.All(char.IsDigit));
            var r = await web.FetchAsync(g.Title, appId, want, ct);
            looked++;
            foreach (var (kind, img) in r.Art)
            {
                cache.Write(g.Id, kind, img.Extension, img.Bytes);
                images++;
            }
            if (r.Failed) failed++;
            else cache.MarkWeb(g.Id, new ArtCache.WebLookup(clock.UtcNow, r.Match, web.HasSteamGridDb));
            onGame?.Invoke(g.Title, r.Art.Keys);
            if (Pace > TimeSpan.Zero) await Task.Delay(Pace, ct);
        }
        return new Summary(looked, images, failed);
    }
}
