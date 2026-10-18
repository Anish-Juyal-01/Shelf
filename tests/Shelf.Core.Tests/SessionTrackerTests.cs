using Shelf.Core.Library;
using Shelf.Core.Model;
using Shelf.Core.Tests.Support;
using Shelf.Core.Watching;

namespace Shelf.Core.Tests;

public class SessionTrackerTests : IDisposable
{
    private readonly TestDb _t = new();
    private readonly FakeClock _clock = new();
    private readonly long _game;
    private readonly long _other;

    public SessionTrackerTests()
    {
        var snap = new LibrarySnapshot
        {
            Games = Dedup.GameMatcher.Merge([
                new InstallRecord { Source = SourceKind.Folder, Title = "Hades", InstallPath = _t.Tree.Dir("Games/Hades") },
                new InstallRecord { Source = SourceKind.Folder, Title = "Celeste", InstallPath = _t.Tree.Dir("Games/Celeste") },
            ]),
        };
        _t.Library.Sync(snap, _clock.UtcNow);
        _game = _t.Library.Games().Single(g => g.Title == "Hades").Id;
        _other = _t.Library.Games().Single(g => g.Title == "Celeste").Id;
    }

    public void Dispose() => _t.Dispose();

    private SessionTracker Tracker(List<SessionEvent>? events = null)
    {
        var tracker = new SessionTracker(_t.Sessions, _clock);
        if (events is not null) tracker.Changed += events.Add;
        return tracker;
    }

    private static RunningGame[] Running(long game, int pid = 100) => [new RunningGame(game, pid, @"C:\Games\Hades\Hades.exe")];

    /// <summary>Polls every 5 s for <paramref name="duration"/> with the given processes running.</summary>
    private void Play(SessionTracker tracker, TimeSpan duration, params RunningGame[] running)
    {
        for (var t = TimeSpan.Zero; t < duration; t += TimeSpan.FromSeconds(5))
        {
            tracker.Observe(running);
            _clock.Advance(TimeSpan.FromSeconds(5));
        }
    }

    private long Total(long game) => _t.Library.Games().Single(g => g.Id == game).TotalSeconds;

    [Fact]
    public void CountsASessionFromStartToLastSeen()
    {
        var events = new List<SessionEvent>();
        var tracker = Tracker(events);
        Play(tracker, TimeSpan.FromMinutes(30), Running(_game));
        Play(tracker, TimeSpan.FromSeconds(20)); // gone: grace expires

        var s = Assert.Single(_t.Sessions.Sessions());
        Assert.Equal("clean", s.EndReason);
        Assert.InRange(s.Duration.TotalMinutes, 29.8, 30);
        Assert.InRange(Total(_game), 29 * 60, 30 * 60);
        Assert.Equal([SessionEventKind.Started, SessionEventKind.Stopped], events.Select(e => e.Kind));
        Assert.NotNull(_t.Library.Games().Single(g => g.Id == _game).LastPlayed);
    }

    [Fact]
    public void ShortGapsDoNotSplitASession()
    {
        var tracker = Tracker();
        Play(tracker, TimeSpan.FromMinutes(5), Running(_game, pid: 1));
        Play(tracker, TimeSpan.FromSeconds(10)); // launcher → game handoff
        Play(tracker, TimeSpan.FromMinutes(5), Running(_game, pid: 2));
        Play(tracker, TimeSpan.FromSeconds(20));
        Assert.Single(_t.Sessions.Sessions());
    }

    [Fact]
    public void TwoProcessesOfOneGameAreOneSession()
    {
        var tracker = Tracker();
        Play(tracker, TimeSpan.FromMinutes(2), new RunningGame(_game, 1, "a.exe"), new RunningGame(_game, 2, "b.exe"));
        Play(tracker, TimeSpan.FromSeconds(20));
        Assert.Single(_t.Sessions.Sessions());
    }

    [Fact]
    public void TwoGamesAtOnceAreTracked()
    {
        var tracker = Tracker();
        Play(tracker, TimeSpan.FromMinutes(2), new RunningGame(_game, 1, "a.exe"), new RunningGame(_other, 2, "b.exe"));
        Play(tracker, TimeSpan.FromSeconds(20));
        Assert.Equal(2, _t.Sessions.Sessions().Count);
    }

    [Fact]
    public void FlashesShorterThanTenSecondsAreDropped()
    {
        var events = new List<SessionEvent>();
        var tracker = Tracker(events);
        Play(tracker, TimeSpan.FromSeconds(5), Running(_game));
        Play(tracker, TimeSpan.FromSeconds(30));
        Assert.Empty(_t.Sessions.Sessions());
        Assert.Equal(0, Total(_game));
        Assert.Single(events); // started only; no "stopped" for a discarded flash
    }

    [Fact]
    public void CrashIsRecoveredAtLastHeartbeat()
    {
        var tracker = Tracker();
        Play(tracker, TimeSpan.FromMinutes(10) + TimeSpan.FromSeconds(30), Running(_game));
        // Shelf dies here: no Shutdown, no close. Next start:
        var recovered = _t.Sessions.RecoverOpenSessions();

        Assert.Equal(1, recovered);
        var s = Assert.Single(_t.Sessions.Sessions());
        Assert.Equal("heartbeat", s.EndReason);
        // Heartbeats every 60 s: at most a minute is lost, nothing is invented.
        Assert.InRange(s.Duration.TotalMinutes, 9.5, 10.5);
        Assert.Equal((long)s.Duration.TotalSeconds, Total(_game));
        Assert.Equal(0, _t.Sessions.RecoverOpenSessions());
    }

    [Fact]
    public void SleepWithoutAPowerEventEndsTheSessionWhenLastSeen()
    {
        var tracker = Tracker();
        Play(tracker, TimeSpan.FromMinutes(20), Running(_game));
        var lastPoll = _clock.UtcNow - TimeSpan.FromSeconds(5);
        _clock.Advance(TimeSpan.FromHours(7)); // overnight; the game is still "running" after resume
        Play(tracker, TimeSpan.FromMinutes(1), Running(_game));

        var sessions = _t.Sessions.Sessions().OrderBy(s => s.Start).ToList();
        Assert.Equal(2, sessions.Count);
        Assert.Equal("suspend", sessions[0].EndReason);
        Assert.Equal(lastPoll, sessions[0].End);
        Assert.Null(sessions[1].End); // still playing
        Assert.InRange(Total(_game), 19 * 60, 20 * 60);
    }

    [Fact]
    public void SuspendAndResumeEvents()
    {
        var tracker = Tracker();
        Play(tracker, TimeSpan.FromMinutes(3), Running(_game));
        tracker.Suspend();
        _clock.Advance(TimeSpan.FromMinutes(30));
        tracker.Resume();
        Play(tracker, TimeSpan.FromMinutes(3), Running(_game));
        tracker.Shutdown();

        var sessions = _t.Sessions.Sessions().OrderBy(s => s.Start).ToList();
        Assert.Equal(["suspend", "app_exit"], sessions.Select(s => s.EndReason));
        Assert.InRange(Total(_game), 5.8 * 60, 6 * 60);
    }

    [Fact]
    public void HeartbeatsAreWrittenWhilePlaying()
    {
        var tracker = Tracker();
        Play(tracker, TimeSpan.FromMinutes(3), Running(_game));
        var open = Assert.Single(_t.Sessions.OpenSessions());
        Assert.True(open.LastHeartbeat > open.Start);
        Assert.True(_clock.UtcNow - open.LastHeartbeat <= TimeSpan.FromSeconds(65));
    }
}
