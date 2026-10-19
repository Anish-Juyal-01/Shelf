using System.Text.Json;
using Microsoft.Data.Sqlite;
using Shelf.Core.Library;
using Shelf.Core.Model;
using Shelf.Core.Naming;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;

namespace Shelf.Core.Storage;

public sealed record GameRow(
    long Id,
    string Key,
    string Title,
    bool Hidden,
    DateTime FirstSeen,
    DateTime? LastPlayed,
    long TotalSeconds,
    long ImportedSeconds,
    DateTime? ImportedLastPlayed,
    bool Installed,
    long SizeBytes,
    int InstalledCopies,
    IReadOnlyList<string> Sources,
    string? PrimaryPath)
{
    /// <summary>Shelf-measured time plus what the launcher had recorded before Shelf.</summary>
    public long PlaySeconds => TotalSeconds + ImportedSeconds;

    public DateTime? LastPlayedAny => LastPlayed is null ? ImportedLastPlayed
        : ImportedLastPlayed is null ? LastPlayed
        : LastPlayed > ImportedLastPlayed ? LastPlayed : ImportedLastPlayed;
}

public sealed record InstallRow(long Id, long GameId, SourceKind Source, string InstallPath, string? LaunchExe, string? LaunchUri,
    string? LaunchArgs, string? WorkingDir, string State, long? SizeBytes);

public sealed record InstallDetail(long Id, long GameId, SourceKind Source, string InstallPath, string? LaunchExe, string? LaunchUri,
    string? LaunchArgs, string? WorkingDir, string State, long? SizeBytes, string? UninstallCommand, int Confidence, IReadOnlyList<string> Signals);

public sealed record DetectionRow(long Id, string Path, string? Exe, string Origin, int Confidence, string SuggestedTitle,
    long? SizeBytes, IReadOnlyList<string> Signals, DateTime Found);

public sealed record SyncResult(IReadOnlyList<string> NewGames, int NewDetections, int RemovedInstalls);

/// <summary>Library persistence: syncing detection results in, user decisions (accept/reject/add/hide/rename), queries out.</summary>
public sealed class LibraryStore(ShelfDb db)
{
    public ShelfDb Db { get; } = db;

    // --- Sync -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Writes a fresh snapshot. Game identity is sticky: if any install of a game is already known, the game keeps
    /// its row (and its playtime history) even if its title or grouping changed. Installs that disappear are only
    /// marked removed when their folder is really gone, so an unplugged drive or a launcher hiccup loses nothing.
    /// </summary>
    public SyncResult Sync(LibrarySnapshot snap, DateTime nowUtc)
    {
        var now = UnixMs.From(nowUtc);
        var newGames = new List<string>();
        var newDetections = 0;
        using var c = Db.Connect();
        using var tx = c.BeginTransaction();

        foreach (var game in snap.Games)
        {
            long? gameId = null;
            foreach (var i in game.Installs)
            {
                gameId = (long?)ShelfDb.Scalar(c, "SELECT game_id FROM installs WHERE path_key = $k", ("$k", PathUtil.Key(i.InstallPath)));
                if (gameId is not null) break;
            }
            gameId ??= (long?)ShelfDb.Scalar(c, "SELECT id FROM games WHERE key = $k", ("$k", game.Key));
            if (gameId is null)
            {
                gameId = InsertGame(c, game.Key, game.Title, now);
                newGames.Add(game.Title);
            }
            else
            {
                ShelfDb.Exec(c, "UPDATE games SET title = $t WHERE id = $id AND title_locked = 0", ("$t", game.Title), ("$id", gameId));
            }
            ShelfDb.Exec(c, """
                UPDATE games SET imported_seconds = MAX(imported_seconds, $s),
                                 imported_last_played = CASE WHEN $lp IS NULL THEN imported_last_played
                                     WHEN imported_last_played IS NULL OR $lp > imported_last_played THEN $lp
                                     ELSE imported_last_played END
                WHERE id = $id
                """,
                ("$s", game.ImportedPlaySeconds), ("$lp", game.ImportedLastPlayed is null ? null : UnixMs.From(game.ImportedLastPlayed.Value)), ("$id", gameId));

            foreach (var i in game.Installs) UpsertInstall(c, gameId.Value, i, now, overwrite: true);
        }

        foreach (var r in snap.Review)
        {
            var key = PathUtil.Key(r.InstallPath);
            // Accepted earlier: it's an install now; just refresh it.
            if (ShelfDb.Scalar(c, "SELECT id FROM installs WHERE path_key = $k", ("$k", key)) is not null)
            {
                ShelfDb.Exec(c, "UPDATE installs SET last_seen = $n, state = 'installed', size_bytes = COALESCE($s, size_bytes) WHERE path_key = $k",
                    ("$n", now), ("$s", r.SizeBytes), ("$k", key));
                continue;
            }
            if (IsIgnored(c, key)) continue;
            var origin = r.Source == SourceKind.InstalledApps ? "installed_apps" : "scan";
            var existed = ShelfDb.Scalar(c, "SELECT 1 FROM detections WHERE path_key = $k", ("$k", key)) is not null;
            ShelfDb.Exec(c, """
                INSERT INTO detections (path_key, path, exe, origin, signals, confidence, suggested_title, size_bytes, state, found, last_seen)
                VALUES ($k, $p, $e, $o, $sig, $conf, $t, $s, 'pending', $n, $n)
                ON CONFLICT(path_key) DO UPDATE SET exe = $e, signals = $sig, confidence = $conf, suggested_title = $t,
                    size_bytes = $s, last_seen = $n
                """,
                ("$k", key), ("$p", r.InstallPath), ("$e", r.LaunchExe), ("$o", origin), ("$sig", Json(r.Signals)),
                ("$conf", r.Confidence), ("$t", r.Title), ("$s", r.SizeBytes), ("$n", now));
            if (!existed) newDetections++;
        }

        // Installs not reported this time: removed only if the folder is really gone. User-added ones are never
        // reported by a source, so they're checked the same way.
        var removed = 0;
        var stale = new List<(long Id, string Path)>();
        using (var cmd = ShelfDb.Command(c, "SELECT id, install_path FROM installs WHERE last_seen < $n AND state != 'removed'", ("$n", now)))
        using (var rd = cmd.ExecuteReader())
            while (rd.Read()) stale.Add((rd.GetInt64(0), rd.GetString(1)));
        foreach (var (id, path) in stale)
        {
            if (Directory.Exists(path)) continue;
            ShelfDb.Exec(c, "UPDATE installs SET state = 'removed' WHERE id = $id", ("$id", id));
            removed++;
        }

        foreach (var s in snap.Sources)
        {
            ShelfDb.Exec(c, """
                INSERT INTO source_status (source, state, message, games_found, checked) VALUES ($s, $st, $m, $g, $n)
                ON CONFLICT(source) DO UPDATE SET state = $st, message = $m, games_found = $g, checked = $n
                """,
                ("$s", s.Source.ToString()), ("$st", s.State.ToString()), ("$m", s.Message), ("$g", s.Installs.Count), ("$n", now));
        }

        tx.Commit();
        return new SyncResult(newGames, newDetections, removed);
    }

    private static long InsertGame(SqliteConnection c, string key, string title, long now)
    {
        // Two different games can clean to the same key only through a user rename; keep keys unique regardless.
        var unique = key;
        for (var n = 2; ShelfDb.Scalar(c, "SELECT 1 FROM games WHERE key = $k", ("$k", unique)) is not null; n++) unique = $"{key}#{n}";
        ShelfDb.Exec(c, "INSERT INTO games (key, title, first_seen) VALUES ($k, $t, $n)", ("$k", unique), ("$t", title), ("$n", now));
        return (long)ShelfDb.Scalar(c, "SELECT last_insert_rowid()")!;
    }

    private static void UpsertInstall(SqliteConnection c, long gameId, InstallRecord i, long now, bool overwrite)
    {
        var key = PathUtil.Key(i.InstallPath);
        ShelfDb.Exec(c, """
            INSERT INTO installs (game_id, source, source_key, install_path, path_key, launch_exe, working_dir, launch_uri, launch_args,
                                  uninstall_command, size_bytes, size_source, state, confidence, signals, first_seen, last_seen)
            VALUES ($g, $src, $sk, $p, $k, $exe, $wd, $uri, $args, $un, $size, $ss, $state, $conf, $sig, $n, $n)
            ON CONFLICT(path_key) DO UPDATE SET
                game_id = $g, source = $src, source_key = $sk, install_path = $p,
                launch_exe = COALESCE($exe, launch_exe), working_dir = COALESCE($wd, working_dir),
                launch_uri = COALESCE($uri, launch_uri), launch_args = COALESCE($args, launch_args),
                uninstall_command = COALESCE($un, uninstall_command),
                size_bytes = COALESCE($size, size_bytes), size_source = CASE WHEN $size IS NULL THEN size_source ELSE $ss END,
                state = $state, confidence = MAX(confidence, $conf), signals = $sig, last_seen = $n
            """,
            ("$g", gameId), ("$src", i.Source.ToString()), ("$sk", i.SourceKey), ("$p", i.InstallPath), ("$k", key),
            ("$exe", i.LaunchExe), ("$wd", i.WorkingDir), ("$uri", i.LaunchUri), ("$args", i.LaunchArgs), ("$un", i.UninstallCommand),
            ("$size", i.SizeBytes), ("$ss", i.SizeSource.ToString()), ("$state", i.IsInstalled ? "installed" : "missing"),
            ("$conf", i.Confidence), ("$sig", Json(i.Signals)), ("$n", now));
        foreach (var exe in i.PlayExes.Append(i.LaunchExe).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase))
        {
            ShelfDb.Exec(c, """
                INSERT INTO game_exes (exe_key, exe_path, game_id) VALUES ($k, $p, $g)
                ON CONFLICT(exe_key) DO UPDATE SET exe_path = $p, game_id = $g
                """, ("$k", PathUtil.Key(exe)), ("$p", exe), ("$g", gameId));
        }
    }

    // --- User decisions -----------------------------------------------------------------------------------------

    /// <summary>Turns a Review/runtime detection into a library game. Returns the game id.</summary>
    public long AcceptDetection(long detectionId, string? title, DateTime nowUtc)
    {
        using var c = Db.Connect();
        using var tx = c.BeginTransaction();
        DetectionRow d;
        using (var cmd = ShelfDb.Command(c, $"{DetectionSelect} WHERE id = $id", ("$id", detectionId)))
        using (var rd = cmd.ExecuteReader())
        {
            if (!rd.Read()) throw new KeyNotFoundException($"No detection #{detectionId}");
            d = ReadDetection(rd);
        }
        var source = d.Origin switch { "runtime" => SourceKind.Runtime, "installed_apps" => SourceKind.InstalledApps, _ => SourceKind.Folder };
        var record = new InstallRecord
        {
            Source = source,
            Title = string.IsNullOrWhiteSpace(title) ? d.SuggestedTitle : title.Trim(),
            InstallPath = d.Path,
            LaunchExe = d.Exe,
            WorkingDir = d.Exe is null ? null : Path.GetDirectoryName(d.Exe),
            SizeBytes = d.SizeBytes,
            SizeSource = d.SizeBytes is null ? SizeSource.Unknown : SizeSource.Measured,
            Confidence = 100,
            Signals = [.. d.Signals, "Confirmed by you"],
        };
        if (d.Exe is not null) record.PlayExes.Add(d.Exe);
        var gameId = AddInstall(c, record, nowUtc, lockTitle: !string.IsNullOrWhiteSpace(title));
        ShelfDb.Exec(c, "UPDATE detections SET state = 'accepted' WHERE id = $id", ("$id", detectionId));
        tx.Commit();
        return gameId;
    }

    /// <summary>"Not a game": never suggested again.</summary>
    public void RejectDetection(long detectionId, DateTime nowUtc)
    {
        using var c = Db.Connect();
        using var tx = c.BeginTransaction();
        var path = (string?)ShelfDb.Scalar(c, "SELECT path_key FROM detections WHERE id = $id", ("$id", detectionId))
            ?? throw new KeyNotFoundException($"No detection #{detectionId}");
        var exe = (string?)ShelfDb.Scalar(c, "SELECT exe FROM detections WHERE id = $id", ("$id", detectionId));
        Ignore(c, path, nowUtc);
        if (exe is not null) Ignore(c, PathUtil.Key(exe), nowUtc);
        ShelfDb.Exec(c, "UPDATE detections SET state = 'rejected' WHERE id = $id", ("$id", detectionId));
        tx.Commit();
    }

    /// <summary>Manual add (an exe dropped on the window). Returns the game id.</summary>
    public long AddManual(string exePath, string? title, DateTime nowUtc, bool measureSize = true)
    {
        var exe = PathUtil.Normalize(exePath);
        if (!File.Exists(exe)) throw new FileNotFoundException("Exe not found", exe);
        var root = FolderClassifier.InstallRootFor(exe);
        var verdict = FolderClassifier.Evaluate(root);
        var record = new InstallRecord
        {
            Source = SourceKind.Manual,
            Title = string.IsNullOrWhiteSpace(title) ? FolderClassifier.TitleFor(root, exe) : title.Trim(),
            InstallPath = root,
            LaunchExe = exe,
            WorkingDir = Path.GetDirectoryName(exe),
            Confidence = 100,
            Signals = ["Added by you"],
            SizeBytes = measureSize ? SizeCalculator.Measure(root) : null,
            SizeSource = measureSize ? SizeSource.Measured : SizeSource.Unknown,
        };
        record.PlayExes.Add(exe);
        foreach (var e in verdict.PlayExes)
            if (!record.PlayExes.Contains(e, StringComparer.OrdinalIgnoreCase)) record.PlayExes.Add(e);

        using var c = Db.Connect();
        using var tx = c.BeginTransaction();
        ShelfDb.Exec(c, "DELETE FROM ignored WHERE key IN ($a, $b)", ("$a", PathUtil.Key(root)), ("$b", PathUtil.Key(exe)));
        var id = AddInstall(c, record, nowUtc, lockTitle: !string.IsNullOrWhiteSpace(title));
        tx.Commit();
        return id;
    }

    private static long AddInstall(SqliteConnection c, InstallRecord record, DateTime nowUtc, bool lockTitle)
    {
        var now = UnixMs.From(nowUtc);
        var key = NameCleaner.Key(record.Title);
        var gameId = (long?)ShelfDb.Scalar(c, "SELECT game_id FROM installs WHERE path_key = $k", ("$k", PathUtil.Key(record.InstallPath)))
            ?? (long?)ShelfDb.Scalar(c, "SELECT id FROM games WHERE key = $k", ("$k", key))
            ?? InsertGame(c, key, record.Title, now);
        if (lockTitle)
            ShelfDb.Exec(c, "UPDATE games SET title = $t, title_locked = 1 WHERE id = $id", ("$t", record.Title), ("$id", gameId));
        UpsertInstall(c, gameId, record, now, overwrite: true);
        return gameId;
    }

    public void SetHidden(long gameId, bool hidden)
    {
        using var c = Db.Connect();
        ShelfDb.Exec(c, "UPDATE games SET hidden = $h WHERE id = $id", ("$h", hidden ? 1 : 0), ("$id", gameId));
    }

    public void Rename(long gameId, string title)
    {
        using var c = Db.Connect();
        ShelfDb.Exec(c, "UPDATE games SET title = $t, title_locked = 1 WHERE id = $id", ("$t", title.Trim()), ("$id", gameId));
    }

    private static void Ignore(SqliteConnection c, string key, DateTime nowUtc) =>
        ShelfDb.Exec(c, "INSERT OR IGNORE INTO ignored (key, added) VALUES ($k, $n)", ("$k", key), ("$n", UnixMs.From(nowUtc)));

    private static bool IsIgnored(SqliteConnection c, string key) =>
        ShelfDb.Scalar(c, "SELECT 1 FROM ignored WHERE key = $k", ("$k", key)) is not null;

    public bool IsIgnored(string key)
    {
        using var c = Db.Connect();
        return IsIgnored(c, key);
    }

    /// <summary>
    /// Records a "looks like you're playing X" suggestion. Returns the detection id, or null if this exe was already
    /// suggested, rejected or is already in the library.
    /// </summary>
    public long? AddRuntimeDetection(string exePath, string title, IEnumerable<string> signals, DateTime nowUtc)
    {
        var exe = PathUtil.Normalize(exePath);
        var root = FolderClassifier.InstallRootFor(exe);
        using var c = Db.Connect();
        using var tx = c.BeginTransaction();
        if (IsIgnored(c, PathUtil.Key(exe)) || IsIgnored(c, PathUtil.Key(root))) return null;
        if (ShelfDb.Scalar(c, "SELECT 1 FROM game_exes WHERE exe_key = $k", ("$k", PathUtil.Key(exe))) is not null) return null;
        if (ShelfDb.Scalar(c, "SELECT 1 FROM detections WHERE path_key = $k AND origin = 'runtime'", ("$k", PathUtil.Key(root))) is not null) return null;
        var now = UnixMs.From(nowUtc);
        ShelfDb.Exec(c, """
            INSERT INTO detections (path_key, path, exe, origin, signals, confidence, suggested_title, state, found, last_seen)
            VALUES ($k, $p, $e, 'runtime', $sig, 60, $t, 'pending', $n, $n)
            ON CONFLICT(path_key) DO UPDATE SET origin = 'runtime', exe = $e, signals = $sig, suggested_title = $t, state = 'pending', last_seen = $n
            """,
            ("$k", PathUtil.Key(root)), ("$p", root), ("$e", exe), ("$sig", Json(signals)), ("$t", title), ("$n", now));
        var id = (long)ShelfDb.Scalar(c, "SELECT id FROM detections WHERE path_key = $k", ("$k", PathUtil.Key(root)))!;
        tx.Commit();
        return id;
    }

    // --- Queries -----------------------------------------------------------------------------------------------

    public List<GameRow> Games(bool includeHidden = false)
    {
        using var c = Db.Connect();
        using var cmd = ShelfDb.Command(c, """
            SELECT g.id, g.key, g.title, g.hidden, g.first_seen, g.last_played, g.total_seconds, g.imported_seconds, g.imported_last_played,
                   SUM(CASE WHEN i.state = 'installed' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN i.state = 'installed' THEN COALESCE(i.size_bytes, 0) ELSE 0 END),
                   GROUP_CONCAT(DISTINCT i.source),
                   (SELECT install_path FROM installs p WHERE p.game_id = g.id ORDER BY p.state = 'installed' DESC, p.id LIMIT 1)
            FROM games g LEFT JOIN installs i ON i.game_id = g.id
            WHERE $all = 1 OR g.hidden = 0
            GROUP BY g.id
            HAVING COUNT(i.id) > 0 OR g.total_seconds > 0
            ORDER BY g.title COLLATE NOCASE
            """, ("$all", includeHidden ? 1 : 0));
        using var rd = cmd.ExecuteReader();
        var list = new List<GameRow>();
        while (rd.Read())
        {
            var copies = rd.IsDBNull(9) ? 0 : rd.GetInt32(9);
            list.Add(new GameRow(
                rd.GetInt64(0), rd.GetString(1), rd.GetString(2), rd.GetInt64(3) == 1,
                UnixMs.ToUtc(rd.GetInt64(4)), NullableTime(rd, 5), rd.GetInt64(6), rd.GetInt64(7), NullableTime(rd, 8),
                copies > 0, rd.IsDBNull(10) ? 0 : rd.GetInt64(10), copies,
                rd.IsDBNull(11) ? [] : rd.GetString(11).Split(','),
                rd.IsDBNull(12) ? null : rd.GetString(12)));
        }
        return list;
    }

    public List<InstallRow> Installs(bool installedOnly = true)
    {
        using var c = Db.Connect();
        using var cmd = ShelfDb.Command(c, """
            SELECT id, game_id, source, install_path, launch_exe, launch_uri, launch_args, working_dir, state, size_bytes
            FROM installs WHERE $all = 1 OR state = 'installed'
            """, ("$all", installedOnly ? 0 : 1));
        using var rd = cmd.ExecuteReader();
        var list = new List<InstallRow>();
        while (rd.Read())
        {
            list.Add(new InstallRow(rd.GetInt64(0), rd.GetInt64(1), Enum.Parse<SourceKind>(rd.GetString(2)), rd.GetString(3),
                Str(rd, 4), Str(rd, 5), Str(rd, 6), Str(rd, 7), rd.GetString(8), rd.IsDBNull(9) ? null : rd.GetInt64(9)));
        }
        return list;
    }

    /// <summary>Known game exes (path key → game id), for matching running processes.</summary>
    public Dictionary<string, long> GameExes()
    {
        using var c = Db.Connect();
        using var cmd = ShelfDb.Command(c, "SELECT e.exe_key, e.game_id FROM game_exes e JOIN games g ON g.id = e.game_id");
        using var rd = cmd.ExecuteReader();
        var map = new Dictionary<string, long>();
        while (rd.Read()) map[rd.GetString(0)] = rd.GetInt64(1);
        return map;
    }

    public HashSet<string> IgnoredKeys()
    {
        using var c = Db.Connect();
        using var cmd = ShelfDb.Command(c, "SELECT key FROM ignored");
        using var rd = cmd.ExecuteReader();
        var set = new HashSet<string>();
        while (rd.Read()) set.Add(rd.GetString(0));
        return set;
    }

    /// <summary>Every install of one game, with what the game page needs (uninstall command, detection signals).</summary>
    public List<InstallDetail> InstallsFor(long gameId)
    {
        using var c = Db.Connect();
        using var cmd = ShelfDb.Command(c, """
            SELECT id, source, install_path, launch_exe, launch_uri, launch_args, working_dir, state, size_bytes,
                   uninstall_command, confidence, signals
            FROM installs WHERE game_id = $g
            ORDER BY state = 'installed' DESC, id
            """, ("$g", gameId));
        using var rd = cmd.ExecuteReader();
        var list = new List<InstallDetail>();
        while (rd.Read())
        {
            list.Add(new InstallDetail(rd.GetInt64(0), gameId, Enum.Parse<SourceKind>(rd.GetString(1)), rd.GetString(2), Str(rd, 3), Str(rd, 4),
                Str(rd, 5), Str(rd, 6), rd.GetString(7), rd.IsDBNull(8) ? null : rd.GetInt64(8), Str(rd, 9), rd.GetInt32(10),
                rd.IsDBNull(11) ? [] : JsonSerializer.Deserialize<List<string>>(rd.GetString(11)) ?? []));
        }
        return list;
    }

    public InstallDetail? Install(long installId)
    {
        using var c = Db.Connect();
        var gameId = (long?)ShelfDb.Scalar(c, "SELECT game_id FROM installs WHERE id = $id", ("$id", installId));
        return gameId is null ? null : InstallsFor(gameId.Value).FirstOrDefault(i => i.Id == installId);
    }

    /// <summary>What each launcher reader reported last time, for honest status in Settings.</summary>
    public List<SourceResult> SourceStatuses()
    {
        using var c = Db.Connect();
        using var cmd = ShelfDb.Command(c, "SELECT source, state, message, games_found FROM source_status");
        using var rd = cmd.ExecuteReader();
        var list = new List<SourceResult>();
        while (rd.Read())
        {
            if (!Enum.TryParse<SourceKind>(rd.GetString(0), out var kind) || !Enum.TryParse<SourceState>(rd.GetString(1), out var st)) continue;
            // Count only; the installs themselves live in the installs table.
            list.Add(new SourceResult(kind, st, rd.GetString(2), new InstallRecord[rd.GetInt32(3)]));
        }
        return [.. list.OrderBy(s => s.Source)];
    }

    private const string DetectionSelect =
        "SELECT id, path, exe, origin, confidence, suggested_title, size_bytes, signals, found FROM detections";

    public List<DetectionRow> PendingDetections()
    {
        using var c = Db.Connect();
        using var cmd = ShelfDb.Command(c, $"{DetectionSelect} WHERE state = 'pending' ORDER BY origin = 'runtime' DESC, confidence DESC");
        using var rd = cmd.ExecuteReader();
        var list = new List<DetectionRow>();
        while (rd.Read()) list.Add(ReadDetection(rd));
        return list;
    }

    public string? GameTitle(long gameId)
    {
        using var c = Db.Connect();
        return (string?)ShelfDb.Scalar(c, "SELECT title FROM games WHERE id = $id", ("$id", gameId));
    }

    private static DetectionRow ReadDetection(SqliteDataReader rd) => new(
        rd.GetInt64(0), rd.GetString(1), Str(rd, 2), rd.GetString(3), rd.GetInt32(4), rd.GetString(5),
        rd.IsDBNull(6) ? null : rd.GetInt64(6),
        rd.IsDBNull(7) ? [] : JsonSerializer.Deserialize<List<string>>(rd.GetString(7)) ?? [],
        UnixMs.ToUtc(rd.GetInt64(8)));

    private static string Json(IEnumerable<string> list) => JsonSerializer.Serialize(list);

    private static string? Str(SqliteDataReader rd, int i) => rd.IsDBNull(i) ? null : rd.GetString(i);

    private static DateTime? NullableTime(SqliteDataReader rd, int i) => rd.IsDBNull(i) ? null : UnixMs.ToUtc(rd.GetInt64(i));
}
