using System.Diagnostics;
using Shelf.Core.Library;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;
using Shelf.Core.Storage;

namespace Shelf.Core.Watching;

public sealed class ShelfWatcherOptions
{
    public TimeSpan Poll { get; init; } = TimeSpan.FromSeconds(5);
    public bool RuntimeDetection { get; init; } = true;
    public bool WatchFolders { get; init; } = true;
    public TimeSpan FolderQuiet { get; init; } = TimeSpan.FromSeconds(60);
    public TimeSpan RunHeartbeat { get; init; } = TimeSpan.FromSeconds(60);

    /// <summary>How often launchers and scan folders are re-read in the background (incremental, ~1 s).</summary>
    public TimeSpan FullRefresh { get; init; } = TimeSpan.FromMinutes(30);
    public SessionTrackerOptions Sessions { get; init; } = new();
    public RuntimeDetectorOptions Runtime { get; init; } = new();
}

public sealed record WatcherNotice(string Kind, string Message, long? GameId = null, long? DetectionId = null);

/// <summary>
/// The background loop: every few seconds it takes a process snapshot, updates sessions, checks the foreground
/// window for unknown games, and handles settled downloads. One thread at below-normal priority, sleeping between
/// polls; everything else is event-driven.
/// </summary>
public sealed class ShelfWatcher : IDisposable
{
    private readonly LibraryStore _library;
    private readonly SessionStore _sessions;
    private readonly LibraryRefresher? _refresher;
    private readonly IProcessSource _processes;
    private readonly IForegroundProbe? _foreground;
    private readonly IGpuSampler? _gpu;
    private readonly IClock _clock;
    private readonly ShelfWatcherOptions _o;
    /// <summary>Raised after the watcher changed the library on its own (new download found, background refresh).</summary>
    public event Action? LibraryChanged;
    private readonly SessionTracker _tracker;
    private readonly RuntimeDetector _detector;
    private readonly object _gate = new();
    private readonly ManualResetEventSlim _stop = new();
    private Thread? _thread;
    private FolderWatcher? _folders;
    private GameIndex _index = GameIndex.Empty;
    private HashSet<string> _ignored = [];
    private long _runId;
    private DateTime _lastRunBeat = DateTime.MinValue;
    private DateTime _lastFullRefresh;

    public event Action<SessionEvent, string>? SessionChanged;
    public event Action<WatcherNotice>? Notice;

    public SessionTracker Tracker => _tracker;

    /// <summary>Games being played right now and when each session started (safe to call from any thread).</summary>
    public IReadOnlyDictionary<long, DateTime> Playing
    {
        get
        {
            lock (_gate) return _tracker.Playing;
        }
    }

    public bool Running => _runId != 0;

    /// <summary>Turns unknown-game detection on or off without restarting.</summary>
    public bool RuntimeDetectionEnabled { get; set; } = true;
    public int KnownGames => _index.Count;
    public IReadOnlyList<string> WatchedFolders => _folders?.Roots ?? [];
    public bool GpuAvailable => _gpu?.Available ?? false;

    public ShelfWatcher(LibraryStore library, SessionStore sessions, LibraryRefresher? refresher, IProcessSource processes,
        IForegroundProbe? foreground, IGpuSampler? gpu, IClock clock, ShelfWatcherOptions? options = null)
    {
        _library = library;
        _sessions = sessions;
        _refresher = refresher;
        _processes = processes;
        _foreground = foreground;
        _gpu = gpu;
        _clock = clock;
        _o = options ?? new ShelfWatcherOptions();
        _tracker = new SessionTracker(sessions, clock, _o.Sessions);
        _detector = new RuntimeDetector(clock, _o.Runtime);
        _tracker.Changed += e => SessionChanged?.Invoke(e, _library.GameTitle(e.GameId) ?? $"game #{e.GameId}");
    }

    /// <summary>Closes sessions left open by a crash, then starts polling on a background thread.</summary>
    public void Start(IEnumerable<string>? watchFolders = null)
    {
        var recovered = _sessions.RecoverOpenSessions((int)_o.Sessions.MinSession.TotalSeconds);
        if (recovered > 0) Notice?.Invoke(new WatcherNotice("recovered", $"Closed {recovered} session(s) left open by a crash or power loss, at their last heartbeat"));
        _runId = _sessions.StartRun(_clock.UtcNow);
        _lastFullRefresh = _clock.UtcNow;
        RefreshIndex();
        if (_o.WatchFolders && watchFolders is not null)
        {
            _folders = new FolderWatcher(watchFolders, _clock, _o.FolderQuiet);
            foreach (var f in _folders.Failed) Notice?.Invoke(new WatcherNotice("folder", $"Can't watch {f} for new downloads (missing or no access)"));
        }
        _thread = new Thread(Loop) { IsBackground = true, Name = "Shelf watcher", Priority = ThreadPriority.BelowNormal };
        _thread.Start();
    }

    /// <summary>Replaces the watched download folders (empty or null turns folder watching off).</summary>
    public void SetWatchFolders(IEnumerable<string>? roots)
    {
        var next = roots is null || !_o.WatchFolders ? null : new FolderWatcher(roots, _clock, _o.FolderQuiet);
        var old = Interlocked.Exchange(ref _folders, next);
        old?.Dispose();
        if (next is not null)
            foreach (var f in next.Failed) Notice?.Invoke(new WatcherNotice("folder", $"Can't watch {f} for new downloads (missing or no access)"));
    }

    public void Stop()
    {
        _stop.Set();
        _thread?.Join(TimeSpan.FromSeconds(10));
        lock (_gate)
        {
            _tracker.Shutdown();
            if (_runId != 0) _sessions.EndRun(_runId, _clock.UtcNow);
            _runId = 0;
        }
    }

    public void Suspend()
    {
        lock (_gate) _tracker.Suspend();
    }

    public void Resume()
    {
        lock (_gate) _tracker.Resume();
    }

    /// <summary>Reloads which exes and folders belong to games (after a library refresh or a manual add).</summary>
    public void RefreshIndex()
    {
        var installs = _library.Installs().Select(i => (i.InstallPath, i.GameId));
        var index = new GameIndex(_library.GameExes(), installs);
        var ignored = _library.IgnoredKeys();
        lock (_gate)
        {
            _index = index;
            _ignored = ignored;
        }
    }

    private void Loop()
    {
        while (!_stop.Wait(_o.Poll))
        {
            try { Tick(); }
            catch (Exception e) { Notice?.Invoke(new WatcherNotice("error", $"Watcher error: {e.Message}")); }
        }
    }

    /// <summary>One poll. Public so tests can drive it with a fake clock.</summary>
    public void Tick()
    {
        var procs = _processes.Snapshot();
        lock (_gate)
        {
            var running = new List<RunningGame>();
            foreach (var p in procs)
            {
                var id = _index.Match(p.Path);
                if (id is not null) running.Add(new RunningGame(id.Value, p.Pid, p.Path));
            }
            _tracker.Observe(running);

            if (_o.RuntimeDetection && RuntimeDetectionEnabled && _foreground is not null) CheckForeground(procs, running);

            var now = _clock.UtcNow;
            if (now - _lastRunBeat >= _o.RunHeartbeat && _runId != 0)
            {
                _sessions.HeartbeatRun(_runId, now);
                _lastRunBeat = now;
            }
        }
        if (_folders is { } folders) HandleFolders(folders);
        if (_refresher is not null && _clock.UtcNow - _lastFullRefresh >= _o.FullRefresh)
        {
            _lastFullRefresh = _clock.UtcNow;
            var r = _refresher.RefreshAll();
            foreach (var t in r.Sync.NewGames) Notice?.Invoke(new WatcherNotice("new", $"New game installed: {t}"));
            RefreshIndex();
            LibraryChanged?.Invoke();
        }
    }

    private void CheckForeground(IReadOnlyList<ProcInfo> procs, List<RunningGame> running)
    {
        var fg = _foreground!.Current();
        RuntimeCandidate? candidate = null;
        if (fg is { } w && running.All(r => r.Pid != w.Pid))
        {
            var path = procs.FirstOrDefault(p => p.Pid == w.Pid).Path;
            if (path is not null && !RuntimeDetector.IsExcluded(path)
                && !_ignored.Contains(PathUtil.Key(path))
                && !_ignored.Contains(PathUtil.Key(FolderClassifier.InstallRootFor(path))))
            {
                var gpu = w.Fullscreen ? null : _gpu?.Sample(w.Pid);
                candidate = new RuntimeCandidate(w.Pid, path, w.Fullscreen, gpu);
            }
        }
        var exe = _detector.Observe(candidate);
        if (exe is null) return;

        var root = FolderClassifier.InstallRootFor(exe);
        var title = FolderClassifier.TitleFor(root, exe);
        var id = _library.AddRuntimeDetection(exe, title, _detector.LastSignals(_o.Runtime.Sustain), _clock.UtcNow);
        if (id is not null)
        {
            Notice?.Invoke(new WatcherNotice("suggest", $"Looks like you're playing {title} — add it?", DetectionId: id));
            LibraryChanged?.Invoke();
        }
    }

    private void HandleFolders(FolderWatcher folders)
    {
        var (settled, overflowed) = folders.Poll();
        if (_refresher is null) return;
        foreach (var path in settled.Concat(overflowed))
        {
            if (!Directory.Exists(path)) continue; // a file (zip) or something deleted; leftovers are picked up by full refreshes
            var (_, sync) = _refresher.RefreshFolder(path);
            foreach (var t in sync.NewGames)
                Notice?.Invoke(new WatcherNotice("new", $"New game found in {Path.GetFileName(Path.GetDirectoryName(path) ?? path)}: {t}"));
            if (sync.NewDetections > 0)
                Notice?.Invoke(new WatcherNotice("review", $"{sync.NewDetections} new folder(s) in {path} to review"));
            if (sync.NewGames.Count > 0) RefreshIndex();
            if (sync.NewGames.Count > 0 || sync.NewDetections > 0) LibraryChanged?.Invoke();
        }
    }

    /// <summary>This process's CPU use since the last call, as a percentage of the whole machine.</summary>
    public static Func<double> CpuMeter()
    {
        var p = Process.GetCurrentProcess();
        var lastCpu = p.TotalProcessorTime;
        var lastWall = Stopwatch.GetTimestamp();
        return () =>
        {
            p.Refresh();
            var cpu = p.TotalProcessorTime;
            var wall = Stopwatch.GetElapsedTime(lastWall);
            var pct = (cpu - lastCpu).TotalMilliseconds / Math.Max(1, wall.TotalMilliseconds) / Environment.ProcessorCount * 100;
            lastCpu = cpu;
            lastWall = Stopwatch.GetTimestamp();
            return pct;
        };
    }

    public void Dispose()
    {
        if (_runId != 0) Stop();
        _folders?.Dispose();
        _gpu?.Dispose();
        _stop.Dispose();
    }
}
