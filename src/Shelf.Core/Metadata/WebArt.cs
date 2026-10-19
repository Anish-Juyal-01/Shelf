using System.Net;
using System.Text.Json;
using Shelf.Core.Art;
using Shelf.Core.Naming;

namespace Shelf.Core.Metadata;

/// <summary>
/// Looks up art Shelf couldn't find on disk. Two sources, both optional:
/// <list type="bullet">
/// <item>Steam (no key): the store's search finds the game's app id by title (or the install already knows it), and
/// the cover, hero and logo come from Steam's image CDN.</item>
/// <item>SteamGridDB (free API key): community art for any game — Steam or not — including square icons.</item>
/// </list>
/// Only the game's title (or Steam app id) is sent. A title only counts as a match when it's the same game after
/// cleaning (editions and punctuation aside), so a wrong cover is much less likely than no cover.
/// </summary>
public sealed class WebArt(HttpClient http, string? steamGridDbKey = null)
{
    public const string SteamCdn = "https://cdn.cloudflare.steamstatic.com/steam/apps";
    public const string SteamSearch = "https://store.steampowered.com/api/storesearch/";
    public const string SteamGridDb = "https://www.steamgriddb.com/api/v2";
    private const int MaxBytes = 15 * 1024 * 1024;

    /// <summary>What was found. <c>Failed</c> means the network let us down (try again later, don't remember a miss).</summary>
    public sealed record Result(Dictionary<ArtKind, Image> Art, string? Match, bool Failed);

    public sealed record Image(byte[] Bytes, string Extension);

    public bool HasSteamGridDb => !string.IsNullOrWhiteSpace(steamGridDbKey);

    public async Task<Result> FetchAsync(string title, string? steamAppId, IReadOnlySet<ArtKind> want, CancellationToken ct)
    {
        var art = new Dictionary<ArtKind, Image>();
        var failed = false;
        string? match = null;
        try
        {
            var appId = steamAppId ?? await FindSteamAppAsync(title, ct);
            if (appId is not null)
            {
                match = $"steam:{appId}";
                if (want.Contains(ArtKind.Cover)) await TryAsync(art, ArtKind.Cover, [$"{SteamCdn}/{appId}/library_600x900_2x.jpg", $"{SteamCdn}/{appId}/library_600x900.jpg"], ct);
                if (want.Contains(ArtKind.Hero)) await TryAsync(art, ArtKind.Hero, [$"{SteamCdn}/{appId}/library_hero.jpg"], ct);
                if (want.Contains(ArtKind.Logo)) await TryAsync(art, ArtKind.Logo, [$"{SteamCdn}/{appId}/logo.png"], ct);
            }
            if (HasSteamGridDb && want.Any(k => !art.ContainsKey(k)))
            {
                var gameId = (appId is not null ? await GridGameBySteamAsync(appId, ct) : null) ?? await GridSearchAsync(title, ct);
                if (gameId is not null)
                {
                    match ??= $"sgdb:{gameId}";
                    foreach (var kind in want.Where(k => !art.ContainsKey(k)))
                        if (await GridUrlAsync(kind, gameId, ct) is { } url)
                            await TryAsync(art, kind, [url], ct);
                }
            }
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            failed = true;
        }
        return new Result(art, match, failed);
    }

    /// <summary>Steam's store search, keeping only a result that's the same game by name.</summary>
    internal async Task<string?> FindSteamAppAsync(string title, CancellationToken ct)
    {
        var json = await GetJsonAsync($"{SteamSearch}?term={Uri.EscapeDataString(title)}&l=english&cc=US", null, ct);
        if (json is null || !json.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array) return null;
        var want = MatchKey(title);
        foreach (var item in items.EnumerateArray())
        {
            if (item.TryGetProperty("name", out var name) && MatchKey(name.GetString() ?? "") == want && item.TryGetProperty("id", out var id))
                return id.ValueKind == JsonValueKind.Number ? id.GetInt64().ToString() : id.GetString();
        }
        return null;
    }

    private async Task<string?> GridGameBySteamAsync(string appId, CancellationToken ct)
    {
        var json = await GetJsonAsync($"{SteamGridDb}/games/steam/{appId}", steamGridDbKey, ct);
        return json is not null && json.RootElement.TryGetProperty("data", out var d) && d.TryGetProperty("id", out var id) ? id.GetRawText() : null;
    }

    private async Task<string?> GridSearchAsync(string title, CancellationToken ct)
    {
        var json = await GetJsonAsync($"{SteamGridDb}/search/autocomplete/{Uri.EscapeDataString(title)}", steamGridDbKey, ct);
        if (json is null || !json.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return null;
        var want = MatchKey(title);
        foreach (var g in data.EnumerateArray())
            if (g.TryGetProperty("name", out var name) && MatchKey(name.GetString() ?? "") == want && g.TryGetProperty("id", out var id))
                return id.GetRawText();
        return null;
    }

    private async Task<string?> GridUrlAsync(ArtKind kind, string gameId, CancellationToken ct)
    {
        var path = kind switch
        {
            ArtKind.Cover => $"grids/game/{gameId}?dimensions=600x900,342x482,660x930&types=static",
            ArtKind.Hero => $"heroes/game/{gameId}?types=static",
            ArtKind.Logo => $"logos/game/{gameId}?types=static&mimes=image/png",
            _ => $"icons/game/{gameId}?types=static&mimes=image/png",
        };
        var json = await GetJsonAsync($"{SteamGridDb}/{path}", steamGridDbKey, ct);
        if (json is null || !json.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return null;
        foreach (var a in data.EnumerateArray())
            if (a.TryGetProperty("url", out var url) && url.GetString() is { } u && u.StartsWith("https://", StringComparison.Ordinal))
                return u;
        return null;
    }

    private async Task TryAsync(Dictionary<ArtKind, Image> art, ArtKind kind, string[] urls, CancellationToken ct)
    {
        foreach (var url in urls)
        {
            using var res = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
            if (res.StatusCode != HttpStatusCode.OK) continue;
            if (res.Content.Headers.ContentLength is > MaxBytes) continue;
            var bytes = await res.Content.ReadAsByteArrayAsync(ct);
            if (bytes.Length is 0 or > MaxBytes || Sniff(bytes) is not { } ext) continue;
            art[kind] = new Image(bytes, ext);
            return;
        }
    }

    private async Task<JsonDocument?> GetJsonAsync(string url, string? bearer, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (bearer is not null) req.Headers.Authorization = new("Bearer", bearer);
        using var res = await http.SendAsync(req, ct);
        if (res.StatusCode is HttpStatusCode.TooManyRequests or >= HttpStatusCode.InternalServerError)
            throw new HttpRequestException($"{(int)res.StatusCode}");
        if (!res.IsSuccessStatusCode) return null;
        try { return JsonDocument.Parse(await res.Content.ReadAsStreamAsync(ct)); }
        catch (JsonException) { return null; }
    }

    /// <summary>The file type from its first bytes — only real images get saved, whatever the server says.</summary>
    internal static string? Sniff(ReadOnlySpan<byte> b) =>
        b.Length < 12 ? null
        : b[0] == 0xFF && b[1] == 0xD8 ? ".jpg"
        : b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' ? ".png"
        : b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P' ? ".webp"
        : b[0] == 0 && b[1] == 0 && b[2] == 1 && b[3] == 0 ? ".ico"
        : null;

    private static readonly string[] EditionWords =
        ["game of the year", "goty", "definitive", "deluxe", "complete", "ultimate", "gold", "premium", "standard", "remastered", "anniversary", "director's cut", "edition"];

    /// <summary>A title's identity for matching search results: <see cref="NameCleaner.Key"/> without edition words.</summary>
    internal static string MatchKey(string title)
    {
        var s = " " + NameCleaner.Clean(title).ToLowerInvariant() + " ";
        foreach (var w in EditionWords) s = s.Replace(" " + w + " ", " ");
        return NameCleaner.Key(s);
    }
}
