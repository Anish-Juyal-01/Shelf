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

internal static partial class Program
{
    private const string Usage = """
        shelf-cli — test Shelf's game detection without the app

          shelf-cli sources                     what each launcher reader found, and any problems
          shelf-cli scan <folder> [options]     scan a folder (or a whole drive, e.g. D:\) for games
              --full        ignore the cache and re-examine every folder
              --no-save     don't remember this folder for `list`
              --no-sizes    skip measuring folder sizes (faster)
          shelf-cli list [options]              refresh, save to the database and show every game with playtime
              --sort name|size|played|time      default: name
              --review      also show low-confidence detections waiting for review
              --leftovers   also show big archives and un-run installers
              --hidden      include games you hid
              --json        machine-readable output
          shelf-cli watch [--stats] [--no-refresh]
                                                track playtime live (Ctrl+C to stop); suggests unknown games
                                                that run fullscreen or use the GPU for 60s; spots new downloads
          shelf-cli sessions [--days N] [game]  play sessions (default: last 14 days)
          shelf-cli review                      detections waiting for a decision
          shelf-cli review accept <id> [title]  add one to the library (optionally with your title)
          shelf-cli review reject <id>          "not a game" — never suggested again
          shelf-cli add <exe> [title]           add a game by its exe
          shelf-cli roots [remove <folder>]     remembered scan folders
          shelf-cli suggest                     folders Shelf would suggest scanning
          shelf-cli clean <name>                run the name cleaner on a folder/exe name
          shelf-cli art [--key K] [--again]     look up missing covers/icons online (Steam; SteamGridDB with a key)

        Shelf only reads: it never changes, moves or deletes anything in game folders. Only `art` goes online.
        Data: %APPDATA%\Shelf (settings.json, shelf.db), cache: %LOCALAPPDATA%\Shelf
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
                "watch" => Watch(rest, cts.Token),
                "sessions" => Sessions(rest),
                "review" => Review(rest),
                "add" => Add(rest),
                "roots" => Roots(rest),
                "suggest" => Suggest(),
                "clean" => Clean(rest),
                "art" => Art(rest, cts.Token),
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
