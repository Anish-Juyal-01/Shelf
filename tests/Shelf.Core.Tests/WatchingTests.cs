using Shelf.Core.Library;
using Shelf.Core.Model;
using Shelf.Core.Tests.Support;
using Shelf.Core.Watching;

namespace Shelf.Core.Tests;

public class GameIndexTests
{
    private static GameIndex Index() => new(
        new Dictionary<string, long> { [@"D:\ELSEWHERE\LAUNCH.EXE"] = 7 },
        [(@"C:\Games\Hades", 1L), (@"C:\Games\Hades\Mods\BigMod", 2L), (@"C:\", 3L)]);

    [Theory]
    [InlineData(@"C:\Games\Hades\x64\Hades.exe", 1L)]
    [InlineData(@"c:\games\hades\Hades.exe", 1L)]
    [InlineData(@"C:\Games\Hades\Mods\BigMod\mod.exe", 2L)]
    [InlineData(@"D:\Elsewhere\launch.exe", 7L)]
    [InlineData(@"C:\Games\HadesII\Hades2.exe", null)]
    [InlineData(@"C:\Games\Hades\UnityCrashHandler64.exe", null)]
    [InlineData(@"C:\Games\Hades\EasyAntiCheat_EOS_Setup.exe", null)]
    [InlineData(@"C:\Windows\explorer.exe", null)]
    [InlineData(null, null)]
    public void Matches(string? exe, long? game) => Assert.Equal(game, Index().Match(exe));
}

public class RuntimeDetectorTests
{
    private const string Exe = @"D:\Stuff\Mystery Game\mystery.exe";

    [Fact]
    public void FullscreenForAMinuteIsSuggestedOnce()
    {
        var clock = new FakeClock();
        var d = new RuntimeDetector(clock);
        string? hit = null;
        for (var i = 0; i < 20; i++)
        {
            hit ??= d.Observe(new RuntimeCandidate(1, Exe, Fullscreen: true, Gpu3D: null));
            if (hit is null) clock.Advance(TimeSpan.FromSeconds(5));
        }
        Assert.Equal(Exe, hit);
        Assert.InRange(clock.UtcNow - new FakeClock().UtcNow, TimeSpan.FromSeconds(59), TimeSpan.FromSeconds(61));
        for (var i = 0; i < 30; i++)
        {
            clock.Advance(TimeSpan.FromSeconds(5));
            Assert.Null(d.Observe(new RuntimeCandidate(1, Exe, true, null)));
        }
    }

    [Fact]
    public void SwitchingAwayResetsTheClock()
    {
        var clock = new FakeClock();
        var d = new RuntimeDetector(clock);
        for (var i = 0; i < 10; i++) { d.Observe(new RuntimeCandidate(1, Exe, true, null)); clock.Advance(TimeSpan.FromSeconds(5)); }
        Assert.Null(d.Observe(null)); // alt-tabbed to the desktop
        for (var i = 0; i < 10; i++)
        {
            Assert.Null(d.Observe(new RuntimeCandidate(1, Exe, true, null)));
            clock.Advance(TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public void WindowedNeedsSustainedGpu()
    {
        var clock = new FakeClock();
        var d = new RuntimeDetector(clock);
        string? hit = null;
        for (var i = 0; i < 15 && hit is null; i++)
        {
            hit = d.Observe(new RuntimeCandidate(1, Exe, false, i == 0 ? null : 80));
            clock.Advance(TimeSpan.FromSeconds(5));
        }
        Assert.Equal(Exe, hit);

        var idle = new RuntimeDetector(clock);
        for (var i = 0; i < 30; i++)
        {
            Assert.Null(idle.Observe(new RuntimeCandidate(2, @"D:\x\editor.exe", false, 5)));
            clock.Advance(TimeSpan.FromSeconds(5));
        }
    }

    [Theory]
    [InlineData(@"C:\Program Files\VideoLAN\VLC\vlc.exe", true)]
    [InlineData(@"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe", true)]
    [InlineData(@"C:\Windows\explorer.exe", true)]
    [InlineData(@"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE", true)]
    [InlineData(@"D:\Games\Mystery\mystery.exe", false)]
    public void Exclusions(string exe, bool excluded) => Assert.Equal(excluded, RuntimeDetector.IsExcluded(exe));
}

public class FolderWatcherTests
{
    [Theory]
    [InlineData(@"D:\Downloads", @"D:\Downloads\Some Game\bin\a.dll", @"D:\Downloads\Some Game")]
    [InlineData(@"D:\Downloads\", @"D:\Downloads\game.zip", @"D:\Downloads\game.zip")]
    [InlineData(@"D:\Downloads", @"D:\Downloads\game.zip.crdownload", null)]
    [InlineData(@"D:\Downloads", @"D:\Other\x", null)]
    [InlineData(@"D:\Downloads", @"D:\Downloads", null)]
    public void TopLevel(string root, string path, string? expected) => Assert.Equal(expected, FolderWatcher.TopLevel(root, path));

    [Fact]
    public void SettlesOnlyAfterQuiet()
    {
        var q = new SettleQueue();
        var t0 = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        q.Touch(@"D:\Downloads\Game", t0);
        q.Touch(@"D:\Downloads\Game", t0.AddSeconds(50));
        Assert.Empty(q.TakeSettled(t0.AddSeconds(60), TimeSpan.FromSeconds(60)));
        Assert.Equal([@"D:\Downloads\Game"], q.TakeSettled(t0.AddSeconds(111), TimeSpan.FromSeconds(60)));
        Assert.Empty(q.TakeSettled(t0.AddSeconds(200), TimeSpan.FromSeconds(60)));
    }

    [Fact]
    public void RealFileSystemEventsAreReported()
    {
        using var t = new TempTree();
        var root = t.Dir("Downloads");
        using var w = new FolderWatcher([root], Core.Platform.SystemClock.Instance, TimeSpan.FromMilliseconds(300));
        GameFixtures.Unity(t, "Downloads/New Game");

        var settled = new List<string>();
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (settled.Count == 0 && DateTime.UtcNow < deadline)
        {
            Thread.Sleep(100);
            settled.AddRange(w.Poll().Settled);
        }
        Assert.Equal([t.P(@"Downloads\New Game")], settled);
    }
}

public class ShelfWatcherTests : IDisposable
{
    private readonly TestDb _t = new();
    private readonly FakeClock _clock = new();
    private readonly FakeProcesses _procs = new();
    private readonly FakeForeground _fg = new();
    private readonly string _hades;

    public ShelfWatcherTests()
    {
        _hades = GameFixtures.Unity(_t.Tree, "Games/Hades");
        _t.Library.Sync(new LibrarySnapshot
        {
            Games = Dedup.GameMatcher.Merge([new InstallRecord { Source = SourceKind.Steam, Title = "Hades", InstallPath = _hades }]),
        }, _clock.UtcNow);
    }

    public void Dispose() => _t.Dispose();

    private ShelfWatcher Watcher() => new(_t.Library, _t.Sessions, null, _procs, _fg, new FakeGpu(), _clock,
        new ShelfWatcherOptions { Poll = Timeout.InfiniteTimeSpan, WatchFolders = false });

    private void Run(ShelfWatcher w, TimeSpan duration)
    {
        for (var t = TimeSpan.Zero; t < duration; t += TimeSpan.FromSeconds(5))
        {
            w.Tick();
            _clock.Advance(TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public void TracksAStoreGameByItsFolderWithoutKnowingTheExe()
    {
        using var w = Watcher();
        var events = new List<string>();
        w.SessionChanged += (e, title) => events.Add($"{e.Kind} {title}");
        w.Start();
        _procs.Running.Add(new ProcInfo(42, "Hades.exe", Path.Combine(_hades, "x64", "Hades.exe")));
        _procs.Running.Add(new ProcInfo(43, "UnityCrashHandler64.exe", Path.Combine(_hades, "UnityCrashHandler64.exe")));
        Run(w, TimeSpan.FromMinutes(2));
        _procs.Running.Clear();
        Run(w, TimeSpan.FromSeconds(30));
        w.Stop();

        Assert.Equal(["Started Hades", "Stopped Hades"], events);
        var s = Assert.Single(_t.Sessions.Sessions());
        Assert.InRange(s.Duration.TotalSeconds, 110, 125);
    }

    [Fact]
    public void StopSavesTheOpenSession()
    {
        using var w = Watcher();
        w.Start();
        _procs.Running.Add(new ProcInfo(42, "Hades.exe", Path.Combine(_hades, "Hades.exe")));
        Run(w, TimeSpan.FromMinutes(1));
        w.Stop();
        Assert.Equal("app_exit", Assert.Single(_t.Sessions.Sessions()).EndReason);
    }

    [Fact]
    public void StartRecoversSessionsFromACrash()
    {
        var gameId = _t.Library.Games().Single().Id;
        var id = _t.Sessions.Open(gameId, null, 1, _clock.UtcNow.AddHours(-2));
        _t.Sessions.Heartbeat([id], _clock.UtcNow.AddHours(-1));
        var notices = new List<WatcherNotice>();
        using var w = Watcher();
        w.Notice += notices.Add;
        w.Start();
        w.Stop();
        Assert.Contains(notices, n => n.Kind == "recovered");
        Assert.Equal(3600, _t.Library.Games().Single().TotalSeconds);
    }

    [Fact]
    public void UnknownFullscreenProgramIsSuggestedOnceAndCanBeAccepted()
    {
        var mystery = Path.Combine(_t.Tree.Dir("Stuff/Mystery"), "mystery.exe");
        File.WriteAllBytes(mystery, new byte[10]);
        using var w = Watcher();
        var notices = new List<WatcherNotice>();
        w.Notice += notices.Add;
        w.Start();
        _procs.Running.Add(new ProcInfo(77, "mystery.exe", mystery));
        _fg.Window = new ForegroundWindow(77, Fullscreen: true);
        Run(w, TimeSpan.FromMinutes(3));

        var suggestion = Assert.Single(notices, n => n.Kind == "suggest");
        Assert.Contains("Mystery", suggestion.Message);
        var detection = Assert.Single(_t.Library.PendingDetections());
        Assert.Equal("runtime", detection.Origin);

        var gameId = _t.Library.AcceptDetection(detection.Id, null, _clock.UtcNow);
        w.RefreshIndex();
        Run(w, TimeSpan.FromMinutes(1));
        w.Stop();
        Assert.Contains(_t.Sessions.Sessions(), s => s.GameId == gameId);
    }

    [Fact]
    public void RejectedProgramsAreNotSuggestedAgain()
    {
        var mystery = Path.Combine(_t.Tree.Dir("Stuff/Tool"), "tool.exe");
        var id = _t.Library.AddRuntimeDetection(mystery, "Tool", ["x"], _clock.UtcNow)!.Value;
        _t.Library.RejectDetection(id, _clock.UtcNow);

        using var w = Watcher();
        var notices = new List<WatcherNotice>();
        w.Notice += notices.Add;
        w.Start();
        _procs.Running.Add(new ProcInfo(5, "tool.exe", mystery));
        _fg.Window = new ForegroundWindow(5, Fullscreen: true);
        Run(w, TimeSpan.FromMinutes(3));
        w.Stop();
        Assert.DoesNotContain(notices, n => n.Kind == "suggest");
    }
}
