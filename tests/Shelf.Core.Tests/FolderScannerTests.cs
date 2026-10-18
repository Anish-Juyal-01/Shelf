using System.Diagnostics;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;
using Shelf.Core.Tests.Support;

namespace Shelf.Core.Tests;

public class FolderScannerTests
{
    private static ScanOptions Options(IReadOnlyCollection<string>? skip = null, bool useCache = true) => new()
    {
        Classifier = GameFixtures.Options,
        LeftoverArchiveBytes = 1000,
        SkipPaths = skip ?? [],
        UseCache = useCache,
    };

    private static TempTree Library()
    {
        var t = new TempTree();
        GameFixtures.Unity(t, "Games/Hollow Knight");
        GameFixtures.Unreal(t, "Games/Stray");
        GameFixtures.LooseRepack(t, "Games/Repacks/Sekiro");
        GameFixtures.Electron(t, "Games/Chatty");
        GameFixtures.FitGirlInstaller(t, "Downloads/Elden Ring [FitGirl Repack]");
        t.File("Downloads/Big Game.zip", 4000);
        t.File("Downloads/small.zip", 10);
        // Weak but plausible: goes to Review.
        t.File("Games/Mystery/mystery.exe", 500);
        t.File("Games/Mystery/steam_api64.dll");
        // A "game" inside a game: only found if the scanner wrongly descends into game roots.
        GameFixtures.Unity(t, "Games/Hollow Knight/hollow_knight_Data/Nested");
        return t;
    }

    [Fact]
    public void FindsGamesReviewAndLeftovers()
    {
        using var t = Library();
        var result = new FolderScanner(Options()).Scan(t.Root);

        Assert.Null(result.Error);
        Assert.False(result.Cancelled);
        Assert.Equal(["Hollow Knight", "Sekiro", "Stray"], result.Library.Select(r => r.Title).Order());
        Assert.Equal("Mystery", Assert.Single(result.Review).Title);
        Assert.Equal(2, result.Leftovers.Count);
        Assert.Contains(result.Leftovers, l => l.Kind == LeftoverKind.Archive && l.Path.EndsWith("Big Game.zip"));
        Assert.Contains(result.Leftovers, l => l.Kind == LeftoverKind.Installer && l.Title == "Elden Ring");
        Assert.DoesNotContain(result.Library, r => r.InstallPath.Contains("Nested"));
        Assert.All(result.Library, r => Assert.True(r.SizeBytes > 0));
    }

    [Fact]
    public void SecondScanReusesTheCacheAndNoticesChanges()
    {
        using var t = Library();
        var cache = new ScanCache();
        var first = new FolderScanner(Options(), cache).Scan(t.Root);
        Assert.Equal(0, first.CacheHits);

        var second = new FolderScanner(Options(), cache).Scan(t.Root);
        Assert.True(second.CacheHits >= 5, $"cache hits: {second.CacheHits}");
        Assert.Equal(first.Library.Select(r => r.Title).Order(), second.Library.Select(r => r.Title).Order());
        Assert.Equal(first.Library.Sum(r => r.SizeBytes), second.Library.Sum(r => r.SizeBytes));

        // A new top-level file changes the folder's modified time: that game is examined again.
        Thread.Sleep(20);
        t.File("Games/Stray/patch.pak", 100);
        var third = new FolderScanner(Options(), cache).Scan(t.Root);
        Assert.Equal(second.CacheHits - 1, third.CacheHits);
    }

    [Fact]
    public void DeletedGamesDropOutOfTheCache()
    {
        using var t = Library();
        var cache = new ScanCache();
        new FolderScanner(Options(), cache).Scan(t.Root);
        Directory.Delete(t.P("Games/Stray"), recursive: true);
        var result = new FolderScanner(Options(), cache).Scan(t.Root);
        Assert.DoesNotContain(result.Library, r => r.Title == "Stray");
        Assert.DoesNotContain(cache.Entries.Keys, k => k.Contains("STRAY"));
    }

    [Fact]
    public void SkipsKnownStoreFolders()
    {
        using var t = Library();
        var result = new FolderScanner(Options(skip: [t.P("Games/Stray")])).Scan(t.Root);
        Assert.DoesNotContain(result.Library, r => r.Title == "Stray");
    }

    [Fact]
    public void CancelsPromptly()
    {
        using var t = Library();
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var sw = Stopwatch.StartNew();
        var result = new FolderScanner(Options()).Scan(t.Root, ct: cts.Token);
        Assert.True(result.Cancelled);
        Assert.True(sw.ElapsedMilliseconds < 2000);
    }

    [Fact]
    public void StreamsEventsAsItGoes()
    {
        using var t = Library();
        var found = new List<string>();
        new FolderScanner(Options()).Scan(t.Root, e =>
        {
            if (e.Kind == ScanEventKind.Found) found.Add(e.Install!.Title);
        });
        Assert.Equal(4, found.Count);
    }

    [Fact]
    public void DoesNotFollowJunctions()
    {
        using var t = Library();
        var link = t.P("Games/LinkToGames");
        var p = Process.Start(new ProcessStartInfo("cmd.exe", $"/c mklink /J \"{link}\" \"{t.P("Games")}\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        })!;
        p.WaitForExit();
        if (!Directory.Exists(link)) return; // junctions unavailable here; nothing to check

        var result = new FolderScanner(Options()).Scan(t.Root);
        Assert.DoesNotContain(result.Library, r => r.InstallPath.Contains("LinkToGames"));
        Directory.Delete(link); // removes the junction only
    }

    [Fact]
    public void MissingRootIsAnErrorNotAnEmptyList()
    {
        var result = new FolderScanner(Options()).Scan(@"Z:\definitely\not\here");
        Assert.NotNull(result.Error);
    }

    [Fact]
    public void ScanningChangesNothingOnDisk()
    {
        using var t = Library();
        static Dictionary<string, (long, DateTime, DateTime)> Snapshot(string root) =>
            Directory.EnumerateFileSystemEntries(root, "*", SearchOption.AllDirectories)
                .ToDictionary(p => p, p => File.Exists(p)
                    ? (new FileInfo(p).Length, File.GetLastWriteTimeUtc(p), File.GetCreationTimeUtc(p))
                    : (-1L, Directory.GetLastWriteTimeUtc(p), Directory.GetCreationTimeUtc(p)));

        var before = Snapshot(t.Root);
        new FolderScanner(Options()).Scan(t.Root);
        new FolderScanner(Options(useCache: false)).Scan(t.Root);
        var after = Snapshot(t.Root);
        Assert.Equal(before, after);
    }

    [Fact]
    public void SuggestsDownloadsAndGamesFolders()
    {
        using var t = new TempTree();
        t.Dir("User/Downloads");
        t.Dir("drive/Games");
        t.Dir("drive/XboxGames");
        t.Dir("drive/Work");
        var suggestions = ScanRootSuggester.Suggest(TestContext.For(t));
        Assert.Contains(suggestions, s => s.EndsWith("Downloads"));
        Assert.Contains(suggestions, s => s.EndsWith(@"drive\Games"));
        Assert.DoesNotContain(suggestions, s => s.EndsWith("XboxGames") || s.EndsWith("Work"));
    }

    [Fact]
    public void DriveRootIsWholeDriveMode()
    {
        var result = new FolderScanner(new ScanOptions { MaxDepth = 0 }).Scan(Path.GetPathRoot(Environment.SystemDirectory)!);
        Assert.True(result.DriveMode);
        Assert.Equal(PathUtil.Normalize(Path.GetPathRoot(Environment.SystemDirectory)!), result.Root);
    }
}
