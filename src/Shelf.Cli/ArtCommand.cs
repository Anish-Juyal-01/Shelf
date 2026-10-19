using System.Net.Http;
using Shelf.Core.Art;
using Shelf.Core.Metadata;
using Shelf.Core.Platform;
using Shelf.Core.Storage;

namespace Shelf.Cli;

internal static partial class Program
{
    /// <summary>Fills in missing art from the web, the same way the app does in the background.</summary>
    private static int Art(List<string> args, CancellationToken ct)
    {
        var again = Flag(args, "--again");
        var (paths, library, _) = OpenStores();
        var key = Option(args, "--key") ?? ShelfSettings.Load(paths).SteamGridDbKey;
        var cache = new ArtCache(paths);
        if (again)
            foreach (var g in library.Games(includeHidden: true)) cache.ForgetWeb(g.Id);

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Shelf-cli/1.0");
        Console.WriteLine(string.IsNullOrWhiteSpace(key)
            ? "Looking up missing art on Steam. (With a SteamGridDB key — --key or Settings — icons and non-Steam games are covered too.)\n"
            : "Looking up missing art on Steam and SteamGridDB.\n");

        var sync = new WebArtSync(library, cache, new WebArt(http, key), SystemClock.Instance);
        var s = sync.RunAsync((title, kinds) =>
            Console.WriteLine($"  {Trunc(title, 40),-40}  {(kinds.Count == 0 ? "nothing found" : string.Join(", ", kinds.Select(k => k.ToString().ToLowerInvariant())))}"), ct)
            .GetAwaiter().GetResult();

        Console.WriteLine(s.Looked == 0
            ? "Nothing to look up: every game has its art, or was looked up this week (--again to retry)."
            : $"\n{s.Looked} games looked up, {s.Images} images saved to {cache.Root}" + (s.Failed > 0 ? $"; {s.Failed} couldn't be reached" : ""));
        return s.Looked > 0 && s.Failed == s.Looked ? 1 : 0;
    }
}
