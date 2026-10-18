using System.Text.Json;
using Shelf.Core.Library;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;
using Shelf.Core.Storage;
using Shelf.Core.Watching;

namespace Shelf.Cli;

internal static partial class Program
{
    private static (ShelfPaths Paths, LibraryStore Library, SessionStore Sessions) OpenStores()
    {
        var paths = ShelfPaths.Default();
        var db = ShelfDb.Open(paths);
        return (paths, new LibraryStore(db), new SessionStore(db));
    }

    private static int List(List<string> args, CancellationToken ct)
    {
        var sort = Option(args, "--sort") ?? "name";
        var showReview = Flag(args, "--review");
        var showLeftovers = Flag(args, "--leftovers");
        var showHidden = Flag(args, "--hidden");
        var json = Flag(args, "--json");

        var (paths, library, _) = OpenStores();
        var refresher = new LibraryRefresher(SystemContext.Real(), paths, library, SystemClock.Instance);
        var full = refresher.RefreshAll(ct: ct);
        var games = library.Games(includeHidden: showHidden);
        var review = library.PendingDetections();

        if (json)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                games,
                review = showReview ? review : null,
                leftovers = showLeftovers ? full.Snapshot.Leftovers : null,
                sources = full.Snapshot.Sources.Select(s => new { source = s.Source.ToString(), state = s.State.ToString(), s.Message, count = s.Installs.Count }),
                scans = full.Snapshot.Scans.Select(s => new { s.Root, s.Error, s.DirsVisited, s.CacheHits, s.Unreadable, seconds = s.Elapsed.TotalSeconds }),
            }, JsonStore.Options));
            return 0;
        }

        IEnumerable<GameRow> rows = sort switch
        {
            "size" => games.OrderByDescending(g => g.SizeBytes),
            "played" => games.OrderByDescending(g => g.LastPlayedAny ?? DateTime.MinValue),
            "time" => games.OrderByDescending(g => g.PlaySeconds),
            _ => games,
        };

        Console.WriteLine($"{"Game",-42} {"Source",-16} {"Size",9} {"Played",8}  {"Last played",-11}  Folder");
        Console.WriteLine(new string('─', Math.Min(ConsoleWidth() - 1, 140)));
        foreach (var g in rows)
        {
            var src = string.Join("+", g.Sources.Select(s => Enum.TryParse<Core.Model.SourceKind>(s, out var k) ? Core.Model.SourceKindExtensions.DisplayName(k) : s));
            var flags = (g.Installed ? "" : " [not installed]") + (g.InstalledCopies > 1 ? $" [{g.InstalledCopies} copies]" : "") + (g.Hidden ? " [hidden]" : "");
            var last = g.LastPlayedAny?.ToLocalTime().ToString("yyyy-MM-dd") ?? "";
            Console.WriteLine($"{Trunc(g.Title + flags, 42),-42} {Trunc(src, 16),-16} {Bytes.Format(g.Installed ? g.SizeBytes : null),9} {Hours(g.PlaySeconds),8}  {last,-11}  {g.PrimaryPath}");
        }
        var installed = games.Where(g => g.Installed).ToList();
        var cold = installed.Where(g => g.LastPlayedAny is null || g.LastPlayedAny < DateTime.UtcNow.AddDays(-90)).ToList();
        Console.WriteLine($"\n{installed.Count} games installed, {Bytes.Format(installed.Sum(g => g.SizeBytes))} on disk" +
            (cold.Count > 0 ? $" · {cold.Count} with no play recorded in 90+ days ({Bytes.Format(cold.Sum(g => g.SizeBytes))})" : "") +
            $" · {review.Count} to review · {full.Snapshot.Leftovers.Count} leftovers ({Bytes.Format(full.Snapshot.Leftovers.Sum(l => l.SizeBytes))})" +
            $" · {full.Elapsed.TotalSeconds:0.0}s");
        if (full.Sync.NewGames.Count > 0) Console.WriteLine($"New since last time: {string.Join(", ", full.Sync.NewGames)}");

        if (showReview && review.Count > 0)
        {
            Console.WriteLine("\nReview (not sure these are games — `shelf-cli review accept|reject <id>`):");
            PrintReview(review);
        }
        if (showLeftovers && full.Snapshot.Leftovers.Count > 0)
        {
            Console.WriteLine("\nLeftovers taking space (Shelf never deletes these — check and remove them yourself):");
            foreach (var l in full.Snapshot.Leftovers)
                Console.WriteLine($"  ~ {Trunc(l.Title, 40),-40} {(l.Kind == LeftoverKind.Archive ? "archive  " : "installer"),-9} {Bytes.Format(l.SizeBytes),9}  {l.Path}");
        }

        var problems = full.Snapshot.Sources.Where(s => s.State is Core.Model.SourceState.Partial or Core.Model.SourceState.Unreadable).ToList();
        var scanProblems = full.Snapshot.Scans.Where(s => s.Error is not null || s.Unreadable > 0).ToList();
        if (problems.Count > 0 || scanProblems.Count > 0)
        {
            Console.WriteLine("\nHeads-up:");
            PrintSources(problems, verbose: true);
            foreach (var s in scanProblems)
                Console.WriteLine($"  [scan] {s.Error ?? $"{s.Root}: {s.Unreadable} folders couldn't be read"}");
        }
        if (ShelfSettings.Load(paths).ScanRoots.Count == 0)
            Console.WriteLine("\nNo scan folders yet — loose games (zips, repacks) only show if Windows lists them. Try: shelf-cli suggest");
        return 0;
    }

    private static int Watch(List<string> args, CancellationToken ct)
    {
        var stats = Flag(args, "--stats");
        var noRefresh = Flag(args, "--no-refresh");
        var (paths, library, sessions) = OpenStores();
        var refresher = new LibraryRefresher(SystemContext.Real(), paths, library, SystemClock.Instance);
        if (!noRefresh)
        {
            Console.WriteLine("Refreshing the library…");
            var r = refresher.RefreshAll(ct: ct);
            Console.WriteLine($"  {library.Games().Count(g => g.Installed)} games installed ({r.Elapsed.TotalSeconds:0.0}s)" +
                (r.Sync.NewGames.Count > 0 ? $" · new: {string.Join(", ", r.Sync.NewGames)}" : ""));
        }

        using var gpu = new PdhGpuSampler();
        using var watcher = new ShelfWatcher(library, sessions, refresher, new Win32ProcessSource(), new Win32ForegroundProbe(), gpu, SystemClock.Instance);
        watcher.SessionChanged += (e, title) =>
        {
            var at = (e.End ?? e.Start).ToLocalTime().ToString("HH:mm");
            Console.WriteLine(e.Kind == SessionEventKind.Started
                ? $"{at}  ▶ {title} started"
                : $"{at}  ■ {title} stopped — {Duration(e.Duration!.Value)}{(e.Reason == "clean" ? "" : $" ({e.Reason})")}");
        };
        watcher.Notice += n =>
        {
            var at = DateTime.Now.ToString("HH:mm");
            Console.WriteLine(n.Kind switch
            {
                "suggest" => $"{at}  ? {n.Message}  →  shelf-cli review accept {n.DetectionId}   (or: review reject {n.DetectionId})",
                "new" => $"{at}  + {n.Message}",
                _ => $"{at}  · {n.Message}",
            });
        };

        var roots = ShelfSettings.Load(paths).ScanRoots;
        watcher.Start(roots);
        Console.WriteLine($"Watching {watcher.KnownGames} game folders · new downloads in: {(roots.Count == 0 ? "(no scan folders)" : string.Join(", ", watcher.WatchedFolders))}");
        Console.WriteLine($"Unknown-game detection: fullscreen{(watcher.GpuAvailable ? " + GPU counters" : " only (GPU counters unavailable)")} · Ctrl+C to stop\n");

        var cpu = ShelfWatcher.CpuMeter();
        var lastStats = DateTime.UtcNow;
        while (!ct.IsCancellationRequested)
        {
            ct.WaitHandle.WaitOne(TimeSpan.FromSeconds(1));
            if (stats && DateTime.UtcNow - lastStats >= TimeSpan.FromSeconds(60))
            {
                lastStats = DateTime.UtcNow;
                var playing = watcher.Tracker.Playing;
                Console.WriteLine($"{DateTime.Now:HH:mm}  · CPU {cpu():0.00}% of the machine over the last minute · " +
                    $"working set {Environment.WorkingSet / Bytes.MB} MB · playing: {(playing.Count == 0 ? "nothing" : string.Join(", ", playing.Keys.Select(k => library.GameTitle(k))))}");
            }
        }
        watcher.Stop();
        Console.WriteLine("Stopped; open sessions saved.");
        return 0;
    }

    private static int Sessions(List<string> args)
    {
        var days = int.TryParse(Option(args, "--days"), out var d) ? d : 14;
        var filter = args.Count > 0 ? string.Join(' ', args) : null;
        var (_, library, sessions) = OpenStores();
        var since = DateTime.UtcNow.AddDays(-days);
        var rows = sessions.Sessions(sinceUtc: since)
            .Where(s => filter is null || s.Title.Contains(filter, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (rows.Count == 0)
        {
            Console.WriteLine($"No sessions in the last {days} days{(filter is null ? "" : $" for '{filter}'")}. Run `shelf-cli watch` while you play.");
        }
        foreach (var day in rows.GroupBy(s => s.Start.ToLocalTime().Date).OrderByDescending(g => g.Key))
        {
            Console.WriteLine($"{day.Key:ddd yyyy-MM-dd}  {Duration(TimeSpan.FromSeconds(day.Sum(s => s.Duration.TotalSeconds)))}");
            foreach (var s in day.OrderBy(s => s.Start))
            {
                var end = s.End?.ToLocalTime().ToString("HH:mm") ?? "now";
                var note = s.End is null ? " (playing)" : s.EndReason is "clean" ? "" : $" ({s.EndReason})";
                Console.WriteLine($"   {s.Start.ToLocalTime():HH:mm}–{end,-5}  {Duration(s.Duration),8}  {s.Title}{note}");
            }
        }

        var gaps = sessions.Runs(since);
        if (rows.Count > 0 && gaps.Count > 0)
            Console.WriteLine($"\nTracking was on for {Duration(TimeSpan.FromSeconds(gaps.Sum(g => ((g.End ?? g.LastHeartbeat) - g.Start).TotalSeconds)))} of the last {days} days; time played while Shelf wasn't running isn't counted.");

        var top = library.Games().Where(g => g.TotalSeconds > 0).OrderByDescending(g => g.TotalSeconds).Take(5).ToList();
        if (top.Count > 0)
        {
            Console.WriteLine("\nMost played (tracked by Shelf, all time):");
            foreach (var g in top) Console.WriteLine($"   {Duration(TimeSpan.FromSeconds(g.TotalSeconds)),8}  {g.Title}");
        }
        return 0;
    }

    private static int Review(List<string> args)
    {
        var (_, library, _) = OpenStores();
        if (args.Count >= 2 && args[0] == "accept" && long.TryParse(args[1], out var acceptId))
        {
            var title = args.Count > 2 ? string.Join(' ', args.Skip(2)) : null;
            var gameId = library.AcceptDetection(acceptId, title, DateTime.UtcNow);
            Console.WriteLine($"Added: {library.GameTitle(gameId)}");
            return 0;
        }
        if (args.Count == 2 && args[0] == "reject" && long.TryParse(args[1], out var rejectId))
        {
            library.RejectDetection(rejectId, DateTime.UtcNow);
            Console.WriteLine("OK — Shelf won't suggest it again.");
            return 0;
        }
        var pending = library.PendingDetections();
        if (pending.Count == 0) Console.WriteLine("Nothing to review.");
        else PrintReview(pending);
        return 0;
    }

    private static void PrintReview(List<DetectionRow> pending)
    {
        foreach (var r in pending)
        {
            var origin = r.Origin switch { "runtime" => "seen running", "installed_apps" => "installed app", _ => "folder scan" };
            Console.WriteLine($"  #{r.Id,-4} {Trunc(r.SuggestedTitle, 36),-36} {r.Confidence,3}%  {Bytes.Format(r.SizeBytes),9}  {origin,-13} {r.Path}");
            foreach (var s in r.Signals) Console.WriteLine($"{"",10}{s}");
        }
    }

    private static int Add(List<string> args)
    {
        if (args.Count == 0) return Fail("Usage: shelf-cli add <path to game exe> [title]");
        var (_, library, _) = OpenStores();
        var title = args.Count > 1 ? string.Join(' ', args.Skip(1)) : null;
        try
        {
            var id = library.AddManual(args[0], title, DateTime.UtcNow);
            Console.WriteLine($"Added: {library.GameTitle(id)}. A running `shelf-cli watch` picks it up at its next library refresh; restart it to track right away.");
            return 0;
        }
        catch (FileNotFoundException e)
        {
            return Fail($"{e.Message}: {e.FileName}");
        }
    }

    private static string Hours(long seconds) => seconds <= 0 ? "" : seconds < 3600 ? $"{seconds / 60}m" : $"{seconds / 3600.0:0.0}h";

    private static string Duration(TimeSpan t) => t.TotalHours >= 1 ? $"{(int)t.TotalHours}h {t.Minutes:00}m" : t.TotalMinutes >= 1 ? $"{t.Minutes}m" : $"{t.Seconds}s";
}
