using System.Diagnostics;
using System.Text.Json;
using Shelf.Core.Library;
using Shelf.Core.Model;
using Shelf.Core.Naming;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;
using Shelf.Core.Sources;
using Shelf.Core.Storage;

namespace Shelf.Cli;

internal static class Program
{
    private const string Usage = """
        shelf-cli — test Shelf's game detection without the app

          shelf-cli sources                     what each launcher reader found, and any problems
          shelf-cli scan <folder> [options]     scan a folder (or a whole drive, e.g. D:\) for games
              --full        ignore the cache and re-examine every folder
              --no-save     don't remember this folder for `list`
              --no-sizes    skip measuring folder sizes (faster)
          shelf-cli list [options]              every game: launchers + remembered folders (incremental)
              --sort name|size|played           default: name
              --review      also show low-confidence detections
              --leftovers   also show big archives and un-run installers
              --why         show the signals behind each detection
              --json        machine-readable output
          shelf-cli roots [remove <folder>]     remembered scan folders
          shelf-cli suggest                     folders Shelf would suggest scanning
          shelf-cli clean <name>                run the name cleaner on a folder/exe name

        Shelf only reads: it never changes, moves or deletes anything in game folders.
        Data: %APPDATA%\Shelf\settings.json, cache: %LOCALAPPDATA%\Shelf\scan-cache.json
        """;

    private static int Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
            Console.Error.WriteLine("\nCancelling…");
        };

        if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
        {
            Console.WriteLine(Usage);
            return 0;
        }
        var rest = args.Skip(1).ToList();
        try
        {
            return args[0].ToLowerInvariant() switch
            {
                "sources" => Sources(rest),
                "scan" => Scan(rest, cts.Token),
                "list" => List(rest, cts.Token),
                "roots" => Roots(rest),
                "suggest" => Suggest(),
                "clean" => Clean(rest),
                _ => Fail($"Unknown command '{args[0]}'.\n\n{Usage}"),
            };
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("Cancelled.");
            return 130;
        }
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }

    private static bool Flag(List<string> args, string name) => args.Remove(name);

    private static string? Option(List<string> args, string name)
    {
        var i = args.IndexOf(name);
        if (i < 0 || i + 1 >= args.Count) return null;
        var v = args[i + 1];
        args.RemoveRange(i, 2);
        return v;
    }

    // ---------------------------------------------------------------------------------------------------------

    private static int Sources(List<string> args)
    {
        var sw = Stopwatch.StartNew();
        var results = SourceReaders.ReadAll(SystemContext.Real());
        PrintSources(results, verbose: true);
        Console.WriteLine($"\n{results.Sum(r => r.Installs.Count)} installs from launchers in {sw.ElapsedMilliseconds} ms");
        foreach (var r in results.Where(r => r.Installs.Count > 0))
        {
            Console.WriteLine($"\n{r.Source.DisplayName()}");
            foreach (var i in r.Installs)
            {
                var state = i.IsInstalled ? "" : "  [folder missing]";
                var conf = i.Source.IsStore() ? "" : $"  ({i.Confidence}%)";
                Console.WriteLine($"  {i.Title}{conf}{state}\n    {i.InstallPath}");
            }
        }
        return 0;
    }

    private static void PrintSources(List<SourceResult> results, bool verbose)
    {
        foreach (var r in results)
        {
            if (!verbose && r.State == SourceState.Ok) continue;
            if (!verbose && r.State == SourceState.NotInstalled) continue;
            var mark = r.State switch
            {
                SourceState.Ok => "ok  ",
                SourceState.Partial => "part",
                SourceState.NotInstalled => " -  ",
                _ => "FAIL",
            };
            Console.WriteLine($"  [{mark}] {r.Source.DisplayName(),-14} {r.Message}");
        }
    }

    private static int Scan(List<string> args, CancellationToken ct)
    {
        var full = Flag(args, "--full");
        var noSave = Flag(args, "--no-save");
        var noSizes = Flag(args, "--no-sizes");
        if (args.Count != 1) return Fail("Usage: shelf-cli scan <folder> [--full] [--no-save] [--no-sizes]");
        var root = PathUtil.Normalize(args[0]);
        if (!Directory.Exists(root)) return Fail($"Folder not found: {root}");

        var paths = ShelfPaths.Default();
        var cache = ScanCacheStore.Load(paths);
        Console.Error.WriteLine("Reading launchers so their games aren't scanned twice…");
        var sources = SourceReaders.ReadAll(SystemContext.Real(), ct);
        var scanner = new FolderScanner(new ScanOptions
        {
            UseCache = !full,
            MeasureSizes = !noSizes,
            SkipPaths = LibraryBuilder.KnownInstallPaths(sources, SystemContext.Real()),
        }, cache);

        Console.WriteLine($"Scanning {root}{(Path.GetPathRoot(root) == root ? " (whole drive)" : "")} — Ctrl+C to stop\n");
        var result = scanner.Scan(root, e =>
        {
            switch (e.Kind)
            {
                case ScanEventKind.Found:
                    var i = e.Install!;
                    var tag = i.Confidence >= 70 ? "+" : "?";
                    ClearProgress();
                    Console.WriteLine($" {tag} {i.Title,-40} {i.Confidence,3}%  {Bytes.Format(i.SizeBytes),9}  {i.InstallPath}");
                    break;
                case ScanEventKind.Leftover:
                    var l = e.Leftover!;
                    ClearProgress();
                    Console.WriteLine($" ~ {l.Title,-40} {(l.Kind == LeftoverKind.Archive ? "archive" : "installer"),4}  {Bytes.Format(l.SizeBytes),9}  {l.Path}");
                    break;
                case ScanEventKind.Progress:
                    if (!Console.IsErrorRedirected)
                    {
                        var p = e.Path.Length > 90 ? "…" + e.Path[^89..] : e.Path;
                        Console.Error.Write($"\r  {e.DirsVisited,7} folders  {p}".PadRight(Math.Max(0, ConsoleWidth() - 1)));
                    }
                    break;
            }
        }, ct);
        ClearProgress();
        ScanCacheStore.Save(paths, cache);

        Console.WriteLine();
        if (result.Error is not null) return Fail(result.Error);
        Console.WriteLine($"{(result.Cancelled ? "Stopped early" : "Done")} in {result.Elapsed.TotalSeconds:0.0}s: " +
            $"{result.Library.Count} games, {result.Review.Count} to review, {result.Leftovers.Count} leftovers · " +
            $"{result.DirsVisited} folders visited, {result.CacheHits} reused from last scan" +
            (result.Unreadable > 0 ? $", {result.Unreadable} couldn't be read" : ""));
        foreach (var err in result.ErrorSamples.Take(5)) Console.WriteLine($"  unreadable: {err}");
        Console.WriteLine(" + = library   ? = review (lower confidence)   ~ = leftover taking space");

        if (!noSave && !result.Cancelled)
        {
            var settings = ShelfSettings.Load(paths);
            if (!settings.ScanRoots.Any(r => PathUtil.Key(r) == PathUtil.Key(root)))
            {
                settings.ScanRoots.Add(root);
                settings.Save(paths);
                Console.WriteLine($"Remembered {root} for `shelf-cli list` (undo: shelf-cli roots remove \"{root}\").");
            }
        }
        return result.Cancelled ? 130 : 0;
    }

    private static int List(List<string> args, CancellationToken ct)
    {
        var sort = Option(args, "--sort") ?? "name";
        var showReview = Flag(args, "--review");
        var showLeftovers = Flag(args, "--leftovers");
        var why = Flag(args, "--why");
        var json = Flag(args, "--json");

        var sw = Stopwatch.StartNew();
        var paths = ShelfPaths.Default();
        var settings = ShelfSettings.Load(paths);
        var cache = ScanCacheStore.Load(paths);
        var sources = SourceReaders.ReadAll(SystemContext.Real(), ct);
        var known = LibraryBuilder.KnownInstallPaths(sources, SystemContext.Real());
        LibraryBuilder.Enrich(sources.SelectMany(s => s.Installs), cache, measureSizes: true, ct);

        var scanner = new FolderScanner(new ScanOptions { SkipPaths = known }, cache);
        var scans = new List<ScanResult>();
        foreach (var root in settings.ScanRoots)
        {
            if (!Directory.Exists(root))
            {
                scans.Add(new ScanResult { Root = root, Error = $"Scan folder not reachable: {root}" });
                continue;
            }
            scans.Add(scanner.Scan(root, ct: ct));
        }
        ScanCacheStore.Save(paths, cache);
        var snap = LibraryBuilder.Build(sources, scans);

        if (json)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                games = snap.Games.Select(g => new
                {
                    g.Title,
                    sources = g.Sources.Select(s => s.DisplayName()),
                    g.SizeBytes,
                    importedHours = Math.Round(g.ImportedPlaySeconds / 3600.0, 1),
                    lastPlayed = g.ImportedLastPlayed,
                    g.HasDuplicates,
                    installs = g.Installs,
                }),
                review = showReview ? snap.Review : null,
                leftovers = showLeftovers ? snap.Leftovers : null,
                sources = snap.Sources.Select(s => new { source = s.Source.DisplayName(), state = s.State.ToString(), s.Message, count = s.Installs.Count }),
                scans = snap.Scans.Select(s => new { s.Root, s.Error, s.DirsVisited, s.CacheHits, s.Unreadable, seconds = s.Elapsed.TotalSeconds }),
            }, JsonStore.Options));
            return 0;
        }

        IEnumerable<GameEntry> games = sort switch
        {
            "size" => snap.Games.OrderByDescending(g => g.SizeBytes),
            "played" => snap.Games.OrderByDescending(g => g.ImportedLastPlayed ?? DateTimeOffset.MinValue),
            _ => snap.Games,
        };

        Console.WriteLine($"{"Game",-42} {"Source",-16} {"Size",9} {"Hours",6}  {"Last played",-11}  Folder");
        Console.WriteLine(new string('─', Math.Min(ConsoleWidth() - 1, 140)));
        foreach (var g in games)
        {
            var src = string.Join("+", g.Sources.Select(s => s.DisplayName()));
            var hours = g.ImportedPlaySeconds > 0 ? (g.ImportedPlaySeconds / 3600.0).ToString("0.0") : "";
            var last = g.ImportedLastPlayed?.LocalDateTime.ToString("yyyy-MM-dd") ?? "";
            var flags = (g.IsInstalled ? "" : " [missing]") + (g.HasDuplicates ? $" [{g.Installs.Count(i => i.IsInstalled)} copies]" : "");
            Console.WriteLine($"{Trunc(g.Title + flags, 42),-42} {Trunc(src, 16),-16} {Bytes.Format(g.IsInstalled ? g.SizeBytes : null),9} {hours,6}  {last,-11}  {g.Primary.InstallPath}");
            if (why)
                foreach (var i in g.Installs)
                    foreach (var s in i.Signals) Console.WriteLine($"{"",6}{i.Source.DisplayName()}: {s}");
        }
        var installedSize = snap.Games.Where(g => g.IsInstalled).Sum(g => g.SizeBytes);
        Console.WriteLine($"\n{snap.Games.Count(g => g.IsInstalled)} games installed, {Bytes.Format(installedSize)} on disk" +
            (snap.Games.Any(g => !g.IsInstalled) ? $" · {snap.Games.Count(g => !g.IsInstalled)} listed but missing" : "") +
            $" · {snap.Review.Count} to review · {snap.Leftovers.Count} leftovers ({Bytes.Format(snap.Leftovers.Sum(l => l.SizeBytes))})" +
            $" · {sw.Elapsed.TotalSeconds:0.0}s");

        if (showReview && snap.Review.Count > 0)
        {
            Console.WriteLine("\nReview (not sure these are games):");
            foreach (var r in snap.Review)
            {
                Console.WriteLine($"  ? {Trunc(r.Title, 40),-40} {r.Confidence,3}%  {Bytes.Format(r.SizeBytes),9}  {r.InstallPath}");
                if (why) foreach (var s in r.Signals) Console.WriteLine($"{"",8}{s}");
            }
        }
        if (showLeftovers && snap.Leftovers.Count > 0)
        {
            Console.WriteLine("\nLeftovers taking space (Shelf never deletes these — check and remove them yourself):");
            foreach (var l in snap.Leftovers)
                Console.WriteLine($"  ~ {Trunc(l.Title, 40),-40} {(l.Kind == LeftoverKind.Archive ? "archive  " : "installer"),-9} {Bytes.Format(l.SizeBytes),9}  {l.Path}");
        }

        var problems = snap.Sources.Where(s => s.State is SourceState.Partial or SourceState.Unreadable).ToList();
        var scanProblems = snap.Scans.Where(s => s.Error is not null || s.Unreadable > 0).ToList();
        if (problems.Count > 0 || scanProblems.Count > 0)
        {
            Console.WriteLine("\nHeads-up:");
            PrintSources(problems, verbose: true);
            foreach (var s in scanProblems)
                Console.WriteLine($"  [scan] {s.Error ?? $"{s.Root}: {s.Unreadable} folders couldn't be read"}");
        }
        if (settings.ScanRoots.Count == 0)
            Console.WriteLine("\nNo scan folders yet — loose games (zips, repacks) only show if Windows lists them. Try: shelf-cli suggest");
        return 0;
    }

    private static int Roots(List<string> args)
    {
        var paths = ShelfPaths.Default();
        var settings = ShelfSettings.Load(paths);
        if (args.Count == 2 && args[0] == "remove")
        {
            var removed = settings.ScanRoots.RemoveAll(r => PathUtil.Key(r) == PathUtil.Key(args[1]));
            settings.Save(paths);
            Console.WriteLine(removed > 0 ? $"Removed {args[1]}" : $"{args[1]} wasn't a scan folder");
            return 0;
        }
        if (settings.ScanRoots.Count == 0) Console.WriteLine("No scan folders. Add one with: shelf-cli scan <folder>");
        foreach (var r in settings.ScanRoots) Console.WriteLine($"  {r}{(Directory.Exists(r) ? "" : "  (not reachable)")}");
        return 0;
    }

    private static int Suggest()
    {
        var list = ScanRootSuggester.Suggest(SystemContext.Real());
        Console.WriteLine("Folders worth scanning:");
        foreach (var p in list) Console.WriteLine($"  shelf-cli scan \"{p}\"");
        Console.WriteLine("Or a whole drive:  shelf-cli scan C:\\");
        return 0;
    }

    private static int Clean(List<string> args)
    {
        if (args.Count == 0) return Fail("Usage: shelf-cli clean <name>");
        var raw = string.Join(' ', args);
        Console.WriteLine(NameCleaner.Clean(raw));
        return 0;
    }

    private static string Trunc(string s, int n) => s.Length <= n ? s : s[..(n - 1)] + "…";

    private static int ConsoleWidth()
    {
        try { return Console.IsOutputRedirected ? 160 : Math.Max(60, Console.WindowWidth); } catch (IOException) { return 160; }
    }

    private static void ClearProgress()
    {
        if (!Console.IsErrorRedirected) Console.Error.Write("\r" + new string(' ', Math.Max(0, ConsoleWidth() - 1)) + "\r");
    }
}
