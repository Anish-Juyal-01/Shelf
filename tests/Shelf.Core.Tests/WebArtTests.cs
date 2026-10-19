using System.Net;
using System.Text;
using Shelf.Core.Art;
using Shelf.Core.Metadata;
using Shelf.Core.Dedup;
using Shelf.Core.Library;
using Shelf.Core.Model;
using Shelf.Core.Storage;
using Shelf.Core.Tests.Support;

namespace Shelf.Core.Tests;

public class WebArtTests
{
    private static readonly byte[] Jpg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0, 1, 1, 1];
    private static readonly byte[] Png = [0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D];

    /// <summary>Answers by URL prefix (longest wins); everything else is a 404. Records every request.</summary>
    private sealed class FakeWeb : HttpMessageHandler
    {
        public readonly Dictionary<string, Func<HttpResponseMessage>> Routes = new();
        public readonly List<(string Url, string? Auth)> Requests = [];

        public void Json(string prefix, string json) => Routes[prefix] = () => new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        public void Bytes(string prefix, byte[] b) => Routes[prefix] = () => new(HttpStatusCode.OK) { Content = new ByteArrayContent(b) };

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            Requests.Add((url, request.Headers.Authorization?.ToString()));
            var hit = Routes.Where(r => url.StartsWith(r.Key, StringComparison.Ordinal)).OrderByDescending(r => r.Key.Length).FirstOrDefault();
            return Task.FromResult(hit.Value?.Invoke() ?? new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }

    private static readonly HashSet<ArtKind> All = [.. Enum.GetValues<ArtKind>()];

    [Theory]
    [InlineData("Sekiro™: Shadows Die Twice - GOTY Edition", "Sekiro Shadows Die Twice GOTY Edition")]
    [InlineData("Disco Elysium - The Final Cut", "Disco Elysium The Final Cut")]
    [InlineData("ELDEN RING", "Elden Ring")]
    [InlineData("Baldur's Gate 3", "Baldurs Gate 3")]
    public void SameGameMatchesAcrossEditionsAndPunctuation(string store, string ours) =>
        Assert.Equal(WebArt.MatchKey(store), WebArt.MatchKey(ours));

    [Theory]
    [InlineData("Hollow Knight: Silksong", "Hollow Knight")]
    [InlineData("Hades II", "Hades")]
    public void DifferentGamesDontMatch(string store, string ours) =>
        Assert.NotEqual(WebArt.MatchKey(store), WebArt.MatchKey(ours));

    [Fact]
    public void OnlyRealImagesAreKept()
    {
        Assert.Equal(".jpg", WebArt.Sniff(Jpg));
        Assert.Equal(".png", WebArt.Sniff(Png));
        Assert.Null(WebArt.Sniff("<!doctype html><html>"u8));
    }

    [Fact]
    public async Task KnownSteamAppGoesStraightToTheCdnWithoutSearching()
    {
        var web = new FakeWeb();
        web.Bytes($"{WebArt.SteamCdn}/620/library_600x900.jpg", Jpg); // no _2x version: falls back
        web.Bytes($"{WebArt.SteamCdn}/620/library_hero.jpg", Jpg);
        var r = await new WebArt(new HttpClient(web)).FetchAsync("Portal 2", "620", All, default);

        Assert.Equal("steam:620", r.Match);
        Assert.Equal(".jpg", r.Art[ArtKind.Cover].Extension);
        Assert.True(r.Art.ContainsKey(ArtKind.Hero));
        Assert.False(r.Art.ContainsKey(ArtKind.Logo)); // 404
        Assert.False(r.Art.ContainsKey(ArtKind.Icon)); // Steam has no big icons; that needs SteamGridDB
        Assert.DoesNotContain(web.Requests, q => q.Url.StartsWith(WebArt.SteamSearch) || q.Url.StartsWith(WebArt.SteamGridDb));
        Assert.False(r.Failed);
    }

    [Fact]
    public async Task SearchPicksTheSameGameNotTheFirstResult()
    {
        var web = new FakeWeb();
        web.Json(WebArt.SteamSearch, """{"total":2,"items":[{"id":1030300,"name":"Hollow Knight: Silksong"},{"id":367520,"name":"Hollow Knight"}]}""");
        web.Bytes($"{WebArt.SteamCdn}/367520/library_600x900_2x.jpg", Jpg);
        var r = await new WebArt(new HttpClient(web)).FetchAsync("Hollow Knight", null, new HashSet<ArtKind> { ArtKind.Cover }, default);
        Assert.Equal("steam:367520", r.Match);
        Assert.True(r.Art.ContainsKey(ArtKind.Cover));
    }

    [Fact]
    public async Task NoConfidentMatchMeansNoArt()
    {
        var web = new FakeWeb();
        web.Json(WebArt.SteamSearch, """{"total":1,"items":[{"id":1,"name":"Some Other Game"}]}""");
        var r = await new WebArt(new HttpClient(web)).FetchAsync("My Homebrew Thing", null, All, default);
        Assert.Null(r.Match);
        Assert.Empty(r.Art);
        Assert.DoesNotContain(web.Requests, q => q.Url.StartsWith(WebArt.SteamCdn));
    }

    [Fact]
    public async Task SteamGridDbFillsTheRestAndOnlyItSeesTheKey()
    {
        var web = new FakeWeb();
        web.Json(WebArt.SteamSearch, """{"total":0,"items":[]}""");
        web.Json($"{WebArt.SteamGridDb}/search/autocomplete/", """{"success":true,"data":[{"id":5,"name":"VALORANT"}]}""");
        web.Json($"{WebArt.SteamGridDb}/icons/game/5", """{"success":true,"data":[{"url":"https://cdn2.steamgriddb.com/icon/v.png"}]}""");
        web.Json($"{WebArt.SteamGridDb}/grids/game/5", """{"success":true,"data":[{"url":"http://insecure.example/grid.jpg"}]}""");
        web.Bytes("https://cdn2.steamgriddb.com/icon/v.png", Png);

        var r = await new WebArt(new HttpClient(web), "secret-key").FetchAsync("VALORANT", null, All, default);
        Assert.Equal("sgdb:5", r.Match);
        Assert.Equal(".png", r.Art[ArtKind.Icon].Extension);
        Assert.False(r.Art.ContainsKey(ArtKind.Cover)); // non-https URLs are ignored
        Assert.All(web.Requests, q => Assert.Equal(q.Url.StartsWith(WebArt.SteamGridDb) ? "Bearer secret-key" : null, q.Auth));
    }

    [Fact]
    public async Task ServerTroubleIsAFailureNotAMiss()
    {
        var web = new FakeWeb();
        web.Routes[WebArt.SteamSearch] = () => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        var r = await new WebArt(new HttpClient(web)).FetchAsync("Hades", null, All, default);
        Assert.True(r.Failed);
        Assert.Empty(r.Art);
    }

    [Fact]
    public async Task SyncFillsGapsOnceAWeekAndAgainWhenAKeyIsAdded()
    {
        using var t = new TestDb();
        var clock = new FakeClock();
        var dir = t.Tree.Dir("steam/Portal 2");
        t.Library.Sync(new LibrarySnapshot
        {
            Games = GameMatcher.Merge([new InstallRecord { Source = SourceKind.Steam, Title = "Portal 2", InstallPath = dir, LaunchUri = "steam://rungameid/620", Confidence = 100 }]),
        }, clock.UtcNow);
        var game = Assert.Single(t.Library.Games());
        var cache = new ArtCache(new ShelfPaths { DataDir = t.Tree.P("data"), CacheDir = t.Tree.P("cache") });
        cache.Write(game.Id, ArtKind.Hero, ".jpg", Jpg); // already found on disk: must not be replaced

        var web = new FakeWeb();
        web.Bytes($"{WebArt.SteamCdn}/620/library_600x900_2x.jpg", Jpg);
        web.Bytes($"{WebArt.SteamCdn}/620/library_hero.jpg", Png);
        var http = new HttpClient(web);
        async Task<WebArtSync.Summary> Run(string? key = null) =>
            await new WebArtSync(t.Library, cache, new WebArt(http, key), clock) { Pace = TimeSpan.Zero }.RunAsync(null, default);

        var first = await Run();
        Assert.Equal(1, first.Images);
        Assert.NotNull(cache.Get(game.Id, ArtKind.Cover));
        Assert.EndsWith(".jpg", cache.Get(game.Id, ArtKind.Hero));
        Assert.DoesNotContain(web.Requests, q => q.Url.EndsWith("library_hero.jpg"));

        web.Requests.Clear();
        Assert.Equal(0, (await Run()).Looked); // tried this week
        Assert.Empty(web.Requests);

        Assert.Equal(1, (await Run("key")).Looked); // a SteamGridDB key is worth another look
        clock.Advance(TimeSpan.FromDays(8));
        Assert.Equal(1, (await Run()).Looked); // and a week later anyway
    }
}
