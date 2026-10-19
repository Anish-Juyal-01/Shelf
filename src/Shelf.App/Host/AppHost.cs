using System.Diagnostics;
using System.IO;
using Shelf.App.Bridge;
using Shelf.Core.Art;
using Shelf.App.Shell;
using Shelf.Core.Launching;
using Shelf.Core.Library;
using Shelf.Core.Model;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;
using Shelf.Core.Storage;
using Shelf.Core.Watching;

namespace Shelf.App.Host;

/// <summary>
/// Everything behind the window: database, detection, the playtime watcher, background refresh/scans, and the
/// commands the UI sends. Thread-safe: commands run on the caller's thread or the thread pool, never the UI thread
/// for anything slow.
/// </summary>
internal sealed class AppHost : IDisposable
{
    public ShelfPaths Paths { get; } = ShelfPaths.Default();
    public LibraryStore Library { get; }
    public SessionStore Sessions { get; }
    public ShelfWatcher Watcher { get; }
    public StartupManager Startup { get; } = new();
    public ArtCache Art { get; }

    private readonly SystemContext _ctx = SystemContext.Real();
    private readonly LibraryRefresher _refresher;
    private readonly PdhGpuSampler _gpu = new();
    private readonly object _gate = new();
    private ShelfSettings _settings;
    private CancellationTokenSource? _scanCts;
    private ScanStatusDto _scan = new(false, null, 0, null, null, null, null);
    private List<LeftoverItem> _leftovers = [];
    private List<string>? _suggestedRoots;

    /// <summary>Library or settings changed: the UI should re-read the state.</summary>
    public event Action? Changed;
    public event Action<ScanStatusDto>? ScanProgress;
    public event Action<HostNotice>? Notice;
    /// <summary>The game page for this id should be re-sent.</summary>
    public event Action<long>? GameChanged;

    public AppHost()
    {
        var db = ShelfDb.Open(Paths);
        Library = new LibraryStore(db);
        Sessions = new SessionStore(db);
        _settings = ShelfSettings.Load(Paths);
        Art = new ArtCache(Paths);
        _refresher = new LibraryRefresher(_ctx, Paths, Library, SystemClock.Instance);
        Watcher = new ShelfWatcher(Library, Sessions, _refresher, new Win32ProcessSource(), new Win32ForegroundProbe(), _gpu, SystemClock.Instance)
        {
            RuntimeDetectionEnabled = _settings.RuntimeDetection,
        };
        Watcher.SessionChanged += (e, title) =>
        {
            if (e.Kind == SessionEventKind.Stopped)
                Notice?.Invoke(new HostNotice("info", $"{title}: {Format.Duration(e.Duration ?? TimeSpan.Zero)} played", GameId: e.GameId));
            Changed?.Invoke();
            GameChanged?.Invoke(e.GameId);
        };
        Watcher.LibraryChanged += () => Changed?.Invoke();
        Watcher.Notice += n => Notice?.Invoke(n.Kind switch
        {
            "suggest" => new HostNotice("info", n.Message, View: "review", Toast: true, ToastTitle: "Shelf spotted a game"),
            "new" => new HostNotice("success", n.Message, View: "library", Toast: true, ToastTitle: "New on your shelf"),
            "error" => new HostNotice("error", n.Message),
            _ => new HostNotice("info", n.Message),
        });
    }

    public ShelfSettings Settings => _settings;

    public void Start()
    {
        Watcher.Start(_settings.WatchFolders ? _settings.ScanRoots : null);
        RefreshAll(firstRun: true);
    }

    // ── Refresh & scans ───────────────────────────────────────────────────────────────────────────────

    public void RefreshAll(bool firstRun = false) => RunScan("Reading launchers", ct =>
    {
        var r = _refresher.RefreshAll(onEvent: OnScanEvent, ct: ct);
        _leftovers = r.Snapshot.Leftovers;
        Watcher.RefreshIndex();
        Changed?.Invoke();
        SyncArt(ct);
        AnnounceNew(r.Sync, toast: !firstRun);
        if (firstRun && !_settings.OnboardingDone)
        {
            _settings.OnboardingDone = true;
            SaveSettings();
            if (_settings.ScanRoots.Count == 0)
                Notice?.Invoke(new HostNotice("info", "Tip: add the folders where you keep downloaded games — Settings → Scan folders", View: "settings"));
        }
        return r.Elapsed;
    });

    /// <summary>One-off search of a folder or a whole drive (not remembered as a scan folder).</summary>
    public void ScanOnce(string path) => RunScan($"Searching {path}", ct =>
    {
        var sw = Stopwatch.StartNew();
        var (scan, sync) = _refresher.RefreshFolder(path, OnScanEvent, ct);
        lock (_gate)
            _leftovers = [.. _leftovers.Where(l => !PathUtil.IsSameOrInside(l.Path, path)).Concat(scan.Leftovers)];
        Watcher.RefreshIndex();
        AnnounceNew(sync, toast: false);
        if (scan.Error is not null) throw new IOException(scan.Error);
        Notice?.Invoke(new HostNotice("success",
            $"Searched {path}: {scan.Library.Count} games, {scan.Review.Count} to review, {scan.Leftovers.Count} leftovers" +
            (scan.Unreadable > 0 ? $" · {scan.Unreadable} folders couldn't be read" : "")));
        return sw.Elapsed;
    });

    public void CancelScan() => _scanCts?.Cancel();

    private void RunScan(string phase, Func<CancellationToken, TimeSpan> work)
    {
        CancellationTokenSource cts;
        lock (_gate)
        {
            if (_scan.Running) return;
            cts = _scanCts = new CancellationTokenSource();
            _scan = _scan with { Running = true, Phase = phase, Dirs = 0, Path = null, Error = null };
        }
        ScanProgress?.Invoke(_scan);
        Task.Run(() =>
        {
            string? error = null;
            TimeSpan? took = null;
            try
            {
                took = work(cts.Token);
            }
            catch (OperationCanceledException)
            {
                Notice?.Invoke(new HostNotice("info", "Scan stopped. What was found so far is kept."));
            }
            catch (Exception e)
            {
                error = e.Message;
                Notice?.Invoke(new HostNotice("error", $"Scan failed: {e.Message}"));
            }
            lock (_gate)
                _scan = new ScanStatusDto(false, null, 0, null, DateTime.UtcNow, took?.TotalSeconds ?? _scan.LastSeconds, error);
            Changed?.Invoke();
        });
    }

    private void OnScanEvent(ScanEvent e)
    {
        if (e.Kind != ScanEventKind.Progress) return;
        ScanStatusDto s;
        lock (_gate) s = _scan = _scan with { Phase = "Scanning folders", Dirs = e.DirsVisited, Path = e.Path };
        ScanProgress?.Invoke(s);
    }

    private void AnnounceNew(SyncResult sync, bool toast)
    {
        if (sync.NewGames.Count is > 0 and <= 3)
            Notice?.Invoke(new HostNotice("success", $"New on your shelf: {string.Join(", ", sync.NewGames)}", View: "library", Toast: toast, ToastTitle: "Shelf"));
        else if (sync.NewGames.Count > 3)
            Notice?.Invoke(new HostNotice("success", $"{sync.NewGames.Count} new games on your shelf", View: "library", Toast: toast, ToastTitle: "Shelf"));
        if (sync.NewDetections > 0)
            Notice?.Invoke(new HostNotice("info", $"{sync.NewDetections} possible game(s) need a look", View: "review"));
        if (sync.RemovedInstalls > 0)
            Notice?.Invoke(new HostNotice("info", $"{sync.RemovedInstalls} game folder(s) are gone from disk — their play history is kept"));
    }

    // ── State for the UI ──────────────────────────────────────────────────────────────────────────────

    public AppStateDto BuildState()
    {
        var now = DateTime.UtcNow;
        var installs = Library.Installs(installedOnly: false);
        var installsByGame = installs.ToLookup(i => i.GameId);
        var playing = Watcher.Playing;
        var games = Library.Games(includeHidden: true).Select(g => ToDto(g, installsByGame[g.Id])).ToList();

        var since = now.AddDays(-35);
        var sessions = Sessions.Sessions(sinceUtc: since, limit: 2000).Select(ToDto).ToList();
        // A session still running counts up to now, not just its last heartbeat.
        sessions = [.. sessions.Select(s => s.End is null && playing.ContainsKey(s.GameId) ? s with { Seconds = (long)(now - s.Start).TotalSeconds } : s)];

        List<LeftoverItem> leftovers;
        ScanStatusDto scan;
        lock (_gate)
        {
            leftovers = _leftovers;
            scan = _scan;
        }

        var gamesByRoot = installs.Where(i => i.State == "installed" && i.SizeBytes is not null)
            .GroupBy(i => Path.GetPathRoot(i.InstallPath)?.ToUpperInvariant() ?? "")
            .ToDictionary(g => g.Key, g => g.Sum(i => i.SizeBytes ?? 0));
        var drives = DriveInfo.GetDrives()
            .Where(d => d.DriveType == DriveType.Fixed && d.IsReady)
            .Select(d => new DriveDto(d.RootDirectory.FullName, string.IsNullOrWhiteSpace(d.VolumeLabel) ? "Local disk" : d.VolumeLabel,
                d.TotalSize, d.AvailableFreeSpace, gamesByRoot.GetValueOrDefault(d.RootDirectory.FullName.ToUpperInvariant())))
            .ToList();

        var runs = Sessions.Runs(since);
        var gaps = new List<GapDto>();
        for (var i = 1; i < runs.Count; i++)
        {
            var end = runs[i - 1].End ?? runs[i - 1].LastHeartbeat;
            if (runs[i].Start - end > TimeSpan.FromMinutes(2)) gaps.Add(new GapDto(end, runs[i].Start));
        }

        var sources = Library.SourceStatuses()
            .Select(s => new SourceDto(s.Source, s.Source.DisplayName(), s.State, s.Message, s.Installs.Count))
            .ToList();

        return new AppStateDto(
            games,
            Library.PendingDetections().Select(d => new DetectionDto(d.Id, d.SuggestedTitle, d.Path, d.Exe, d.Origin, d.Confidence, d.SizeBytes, d.Signals, d.Found)).ToList(),
            sources,
            leftovers.Select(l => new LeftoverDto(l.Path, l.Kind == LeftoverKind.Archive ? "archive" : "installer", l.Title, l.SizeBytes)).ToList(),
            drives,
            scan,
            BuildSettings(drives),
            playing.Select(p => new PlayingDto(p.Key, p.Value)).ToList(),
            sessions,
            gaps,
            new WatchDto(Watcher.Running, _gpu.Available, runs.FirstOrDefault()?.Start));
    }

    private SettingsDto BuildSettings(List<DriveDto> drives)
    {
        _suggestedRoots ??= ScanRootSuggester.Suggest(_ctx);
        var roots = _settings.ScanRoots;
        return new SettingsDto(
            _settings.Theme,
            Palettes.Contains(_settings.Palette) ? _settings.Palette : "sunset",
            _settings.HeroStyle is "ring" ? "ring" : "wheel",
            roots.Select(r => new RootDto(r, Directory.Exists(r))).ToList(),
            _suggestedRoots.Where(s => !roots.Any(r => PathUtil.Key(r) == PathUtil.Key(s))).ToList(),
            drives.Select(d => d.Root).ToList(),
            _settings.RuntimeDetection,
            _settings.WatchFolders,
            SafeStartupEnabled(),
            _settings.CloseToTray,
            Paths.DataDir);
    }

    private bool SafeStartupEnabled()
    {
        try { return Startup.IsEnabled; } catch (Exception) { return false; }
    }

    public GameDetailDto? GameDetail(long id)
    {
        var row = Library.Games(includeHidden: true).FirstOrDefault(g => g.Id == id);
        if (row is null) return null;
        var installs = Library.InstallsFor(id);
        var game = ToDto(row, installs.Select(i => new InstallRow(i.Id, i.GameId, i.Source, i.InstallPath, i.LaunchExe, i.LaunchUri, i.LaunchArgs, i.WorkingDir, i.State, i.SizeBytes)));
        return new GameDetailDto(
            game,
            installs.Select(i => new InstallDto(i.Id, i.Source, i.InstallPath, i.LaunchExe, i.State, i.SizeBytes, i.Confidence, i.Signals, GameLauncher.UninstallLabel(i))).ToList(),
            Sessions.Sessions(gameId: id, limit: 5000).Select(ToDto).ToList());
    }

    /// <summary>
    /// Copies art that's already on this PC into Shelf's art cache: Steam's library images, Xbox logos, and each
    /// loose game's own exe icon. No network. Runs after every refresh; cheap when nothing changed.
    /// </summary>
    private void SyncArt(CancellationToken ct)
    {
        var locator = new ArtLocator(_ctx);
        var changed = false;
        foreach (var g in Library.Games(includeHidden: true).Where(g => g.Installed))
        {
            if (ct.IsCancellationRequested) return;
            var found = new Dictionary<ArtKind, string>();
            var installs = Library.InstallsFor(g.Id).Where(i => i.State == "installed").ToList();
            foreach (var i in installs)
                foreach (var (k, v) in locator.Find(i)) found.TryAdd(k, v);
            changed |= Art.Store(g.Id, found);
            if (!found.ContainsKey(ArtKind.Cover) && !found.ContainsKey(ArtKind.Icon) && !Art.Has(g.Id, ArtKind.Icon))
            {
                // The game's own exe: the launch exe when it lives in the game folder, otherwise the best exe the
                // classifier finds there (VALORANT launches through the Riot Client, whose icon isn't the game's).
                var exe = installs
                    .Select(i => i.LaunchExe is not null && PathUtil.IsSameOrInside(i.LaunchExe, i.InstallPath) ? i.LaunchExe : FolderClassifier.Evaluate(i.InstallPath).LaunchExe)
                    .FirstOrDefault(e => e is not null && e.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(e));
                if (exe is not null && IconExtractor.Png(exe) is { } png)
                {
                    Art.Write(g.Id, ArtKind.Icon, ".png", png);
                    changed = true;
                }
            }
        }
        if (changed) Changed?.Invoke();
    }

    private string? ArtUrl(long gameId, ArtKind kind)
    {
        var file = Art.Get(gameId, kind);
        if (file is null) return null;
        var v = File.GetLastWriteTimeUtc(file).Ticks;
        return $"https://shelf.local/art/{gameId}/{Path.GetFileName(file)}?v={v}";
    }

    private GameDto ToDto(GameRow g, IEnumerable<InstallRow> installs)
    {
        var list = installs.ToList();
        var canLaunch = list.Any(i => i.State == "installed" && (i.LaunchUri is not null || (i.LaunchExe is not null && File.Exists(i.LaunchExe))));
        return new GameDto(g.Id, g.Title, list.Select(i => i.Source).Distinct().ToList(), g.Installed, g.Hidden, g.SizeBytes, g.InstalledCopies,
            g.PlaySeconds, g.TotalSeconds, g.ImportedSeconds, g.LastPlayedAny, g.FirstSeen, g.PrimaryPath, canLaunch, [], null,
            ArtUrl(g.Id, ArtKind.Cover), ArtUrl(g.Id, ArtKind.Hero), ArtUrl(g.Id, ArtKind.Logo), ArtUrl(g.Id, ArtKind.Icon));
    }

    private static SessionDto ToDto(SessionRow s) =>
        new(s.Id, s.GameId, s.Title, s.Start, s.End, (long)s.Duration.TotalSeconds, s.EndReason);

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    public void Launch(long gameId)
    {
        var installs = Library.InstallsFor(gameId).Where(GameLauncher.CanLaunch).ToList();
        // Prefer the launcher's own way in (keeps cloud saves, overlays, updates working), then a known exe.
        var pick = installs.FirstOrDefault(i => i.Source.IsStore() && i.LaunchUri is not null) ?? installs.FirstOrDefault();
        if (pick is null)
        {
            Notice?.Invoke(new HostNotice("error", "Shelf doesn't know how to start this game. Open its folder and run it once — Shelf will remember it."));
            return;
        }
        var r = GameLauncher.Launch(pick);
        Notice?.Invoke(new HostNotice(r.Ok ? "info" : "error", r.Ok ? $"{r.Message}…" : r.Message));
    }

    public void Uninstall(long installId)
    {
        var i = Library.Install(installId);
        if (i is null) return;
        var r = GameLauncher.Uninstall(i);
        Notice?.Invoke(new HostNotice(r.Ok ? "info" : "error", r.Message));
    }

    public void SetHidden(long gameId, bool hidden)
    {
        Library.SetHidden(gameId, hidden);
        Changed?.Invoke();
        GameChanged?.Invoke(gameId);
    }

    public void Rename(long gameId, string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return;
        Library.Rename(gameId, title);
        Changed?.Invoke();
        GameChanged?.Invoke(gameId);
    }

    public void Accept(long detectionId, string? title)
    {
        var id = Library.AcceptDetection(detectionId, title, DateTime.UtcNow);
        Watcher.RefreshIndex();
        Notice?.Invoke(new HostNotice("success", $"Added {Library.GameTitle(id)} to your shelf", GameId: id));
        Changed?.Invoke();
    }

    public void Reject(long detectionId)
    {
        Library.RejectDetection(detectionId, DateTime.UtcNow);
        Changed?.Invoke();
    }

    /// <summary>Exes dropped on the window or picked in the file dialog; folders dropped are searched once.</summary>
    public void AddPaths(IEnumerable<string> paths)
    {
        foreach (var p in paths)
        {
            if (Directory.Exists(p))
            {
                ScanOnce(p);
                continue;
            }
            if (!p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                Notice?.Invoke(new HostNotice("error", $"{Path.GetFileName(p)} isn't a program — drop the game's .exe (or its folder)."));
                continue;
            }
            try
            {
                var id = Library.AddManual(p, null, DateTime.UtcNow);
                Watcher.RefreshIndex();
                Notice?.Invoke(new HostNotice("success", $"Added {Library.GameTitle(id)} — playtime is tracked from now on", GameId: id));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                Notice?.Invoke(new HostNotice("error", $"Couldn't add {Path.GetFileName(p)}: {e.Message}"));
            }
        }
        Changed?.Invoke();
    }

    public void AddRoot(string path)
    {
        var p = PathUtil.Normalize(path);
        if (!Directory.Exists(p)) return;
        if (_settings.ScanRoots.Any(r => PathUtil.Key(r) == PathUtil.Key(p))) return;
        _settings.ScanRoots.Add(p);
        SaveSettings();
        Watcher.SetWatchFolders(_settings.WatchFolders ? _settings.ScanRoots : null);
        Changed?.Invoke();
        ScanOnce(p);
    }

    public void RemoveRoot(string path)
    {
        _settings.ScanRoots.RemoveAll(r => PathUtil.Key(r) == PathUtil.Key(path));
        SaveSettings();
        Watcher.SetWatchFolders(_settings.WatchFolders ? _settings.ScanRoots : null);
        Changed?.Invoke();
    }

    private static readonly HashSet<string> Palettes = ["sunset", "aurora", "neon", "dune", "deepsea", "sakura"];

    public void UpdateSettings(string? theme, string? palette, string? heroStyle, bool? runtimeDetection, bool? watchFolders, bool? startWithWindows, bool? closeToTray)
    {
        if (theme is "system" or "light" or "dark") _settings.Theme = theme;
        if (heroStyle is "wheel" or "ring") _settings.HeroStyle = heroStyle;
        if (palette is not null && Palettes.Contains(palette)) _settings.Palette = palette;
        if (runtimeDetection is { } rd)
        {
            _settings.RuntimeDetection = rd;
            Watcher.RuntimeDetectionEnabled = rd;
        }
        if (watchFolders is { } wf)
        {
            _settings.WatchFolders = wf;
            Watcher.SetWatchFolders(wf ? _settings.ScanRoots : null);
        }
        if (closeToTray is { } ct) _settings.CloseToTray = ct;
        if (startWithWindows is { } sw)
        {
            try
            {
                Startup.SetEnabled(sw);
            }
            catch (InvalidOperationException e)
            {
                Notice?.Invoke(new HostNotice("error", e.Message));
            }
        }
        SaveSettings();
        Changed?.Invoke();
    }

    public void OpenFolder(string path)
    {
        if (Directory.Exists(path)) Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = false });
        else Notice?.Invoke(new HostNotice("error", $"Folder not found: {path}"));
    }

    public void Reveal(string path)
    {
        if (File.Exists(path) || Directory.Exists(path)) Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = false });
        else Notice?.Invoke(new HostNotice("error", $"Not found any more: {path}"));
    }

    public void OpenDataFolder()
    {
        Directory.CreateDirectory(Paths.DataDir);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{Paths.DataDir}\"") { UseShellExecute = false });
    }

    private void SaveSettings()
    {
        try
        {
            _settings.Save(Paths);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Notice?.Invoke(new HostNotice("error", $"Couldn't save settings: {e.Message}"));
        }
    }

    public void Dispose()
    {
        _scanCts?.Cancel();
        Watcher.Stop();
        Watcher.Dispose();
    }
}

internal static class Format
{
    public static string Duration(TimeSpan t) =>
        t.TotalHours >= 1 ? $"{(int)t.TotalHours}h {t.Minutes:00}m" : t.TotalMinutes >= 1 ? $"{t.Minutes} min" : $"{t.Seconds}s";
}
