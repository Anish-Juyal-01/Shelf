using Shelf.Core.Platform;

namespace Shelf.Core.Watching;

public readonly record struct RunningGame(long GameId, int Pid, string? ExePath);

public enum SessionEventKind { Started, Stopped }

public sealed record SessionEvent(SessionEventKind Kind, long GameId, long SessionId, DateTime Start, DateTime? End, string? Reason)
{
    public TimeSpan? Duration => End - Start;
}

public sealed class SessionTrackerOptions
{
    /// <summary>A game must be gone this long before its session ends (covers launcher → game handoffs and restarts).</summary>
    public TimeSpan Grace { get; init; } = TimeSpan.FromSeconds(15);

    /// <summary>How often open sessions are stamped; a crash loses at most this much.</summary>
    public TimeSpan Heartbeat { get; init; } = TimeSpan.FromSeconds(60);

    /// <summary>Sessions shorter than this (a launcher flashing past, a crash on start) aren't kept.</summary>
    public TimeSpan MinSession { get; init; } = TimeSpan.FromSeconds(10);

    /// <summary>A gap between polls longer than this means the PC slept (even if no power event arrived).</summary>
    public TimeSpan SleepGap { get; init; } = TimeSpan.FromSeconds(90);
}

/// <summary>
/// Turns "which games are running now" observations into sessions. Pure logic over a clock and a store, so every
/// edge case (sleep, crash, restarts, short launches) is unit-tested with a fake clock. Not thread-safe: call it
/// from one thread (the watcher loop).
/// </summary>
public sealed class SessionTracker(ISessionStore store, IClock clock, SessionTrackerOptions? options = null)
{
    private readonly SessionTrackerOptions _o = options ?? new SessionTrackerOptions();
    private readonly Dictionary<long, Live> _live = [];
    private DateTime? _lastPoll;
    private DateTime _lastBeat = DateTime.MinValue;

    private sealed class Live
    {
        public long SessionId;
        public DateTime Start;
        public DateTime LastSeen;
    }

    public event Action<SessionEvent>? Changed;

    /// <summary>Games currently being played and when their session started.</summary>
    public IReadOnlyDictionary<long, DateTime> Playing => _live.ToDictionary(kv => kv.Key, kv => kv.Value.Start);

    public void Observe(IReadOnlyCollection<RunningGame> running)
    {
        var now = clock.UtcNow;
        if (_lastPoll is { } last && now - last > _o.SleepGap)
        {
            // Asleep or suspended without telling us: whatever was running ended when we last saw it.
            CloseAll(last, "suspend");
        }

        foreach (var g in running.GroupBy(r => r.GameId))
        {
            if (_live.TryGetValue(g.Key, out var live))
            {
                live.LastSeen = now;
                continue;
            }
            var first = g.First();
            var id = store.Open(g.Key, first.ExePath, first.Pid, now);
            _live[g.Key] = new Live { SessionId = id, Start = now, LastSeen = now };
            Changed?.Invoke(new SessionEvent(SessionEventKind.Started, g.Key, id, now, null, null));
        }

        var runningIds = running.Select(r => r.GameId).ToHashSet();
        foreach (var (gameId, live) in _live.ToList())
        {
            if (runningIds.Contains(gameId)) continue;
            if (now - live.LastSeen >= _o.Grace) Close(gameId, live, live.LastSeen, "clean");
        }

        if (now - _lastBeat >= _o.Heartbeat && _live.Count > 0)
        {
            store.Heartbeat(_live.Values.Select(l => l.SessionId).ToList(), now);
            _lastBeat = now;
        }
        _lastPoll = now;
    }

    /// <summary>The PC is going to sleep: end everything now.</summary>
    public void Suspend()
    {
        CloseAll(clock.UtcNow, "suspend");
        _lastPoll = null;
    }

    /// <summary>Back from sleep: start fresh; games still running get new sessions on the next poll.</summary>
    public void Resume() => _lastPoll = null;

    /// <summary>Shelf is exiting cleanly.</summary>
    public void Shutdown() => CloseAll(clock.UtcNow, "app_exit");

    private void CloseAll(DateTime at, string reason)
    {
        foreach (var (gameId, live) in _live.ToList()) Close(gameId, live, at, reason);
    }

    private void Close(long gameId, Live live, DateTime end, string reason)
    {
        if (end < live.Start) end = live.Start;
        var discard = end - live.Start < _o.MinSession;
        store.Close(live.SessionId, end, reason, discard);
        _live.Remove(gameId);
        if (!discard) Changed?.Invoke(new SessionEvent(SessionEventKind.Stopped, gameId, live.SessionId, live.Start, end, reason));
    }
}
