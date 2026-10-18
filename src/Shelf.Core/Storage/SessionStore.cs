using Microsoft.Data.Sqlite;
using Shelf.Core.Platform;
using Shelf.Core.Watching;

namespace Shelf.Core.Storage;

public sealed record SessionRow(long Id, long GameId, string Title, DateTime Start, DateTime? End, DateTime LastHeartbeat, string? EndReason)
{
    /// <summary>Open sessions count up to their last heartbeat.</summary>
    public TimeSpan Duration => (End ?? LastHeartbeat) - Start;
}

/// <summary>Gaps when nothing was tracking (Shelf not running).</summary>
public sealed record WatcherRun(long Id, DateTime Start, DateTime LastHeartbeat, DateTime? End);

public sealed class SessionStore(ShelfDb db) : ISessionStore
{
    public long Open(long gameId, string? exePath, int pid, DateTime startUtc)
    {
        using var c = db.Connect();
        var t = UnixMs.From(startUtc);
        ShelfDb.Exec(c, "INSERT INTO sessions (game_id, exe_path, pid, started, last_heartbeat) VALUES ($g, $e, $p, $t, $t)",
            ("$g", gameId), ("$e", exePath), ("$p", pid), ("$t", t));
        return (long)ShelfDb.Scalar(c, "SELECT last_insert_rowid()")!;
    }

    public void Heartbeat(IReadOnlyCollection<long> sessionIds, DateTime nowUtc)
    {
        if (sessionIds.Count == 0) return;
        using var c = db.Connect();
        using var tx = c.BeginTransaction();
        foreach (var id in sessionIds)
            ShelfDb.Exec(c, "UPDATE sessions SET last_heartbeat = $t WHERE id = $id AND ended IS NULL", ("$t", UnixMs.From(nowUtc)), ("$id", id));
        tx.Commit();
    }

    public void Close(long sessionId, DateTime endUtc, string reason, bool discard = false)
    {
        using var c = db.Connect();
        using var tx = c.BeginTransaction();
        CloseIn(c, sessionId, UnixMs.From(endUtc), reason, discard);
        tx.Commit();
    }

    private static void CloseIn(SqliteConnection c, long sessionId, long end, string reason, bool discard)
    {
        long gameId, start;
        using (var cmd = ShelfDb.Command(c, "SELECT game_id, started FROM sessions WHERE id = $id AND ended IS NULL", ("$id", sessionId)))
        using (var rd = cmd.ExecuteReader())
        {
            if (!rd.Read()) return; // already closed
            gameId = rd.GetInt64(0);
            start = rd.GetInt64(1);
        }
        if (discard)
        {
            ShelfDb.Exec(c, "DELETE FROM sessions WHERE id = $id", ("$id", sessionId));
            return;
        }
        end = Math.Max(end, start);
        ShelfDb.Exec(c, "UPDATE sessions SET ended = $e, last_heartbeat = MAX(last_heartbeat, $e), end_reason = $r WHERE id = $id",
            ("$e", end), ("$r", reason), ("$id", sessionId));
        ShelfDb.Exec(c, """
            UPDATE games SET total_seconds = total_seconds + $d,
                             last_played = CASE WHEN last_played IS NULL OR last_played < $e THEN $e ELSE last_played END
            WHERE id = $g
            """, ("$d", (end - start) / 1000), ("$e", end), ("$g", gameId));
    }

    public IReadOnlyList<OpenSessionInfo> OpenSessions()
    {
        using var c = db.Connect();
        using var cmd = ShelfDb.Command(c, "SELECT id, game_id, started, last_heartbeat FROM sessions WHERE ended IS NULL");
        using var rd = cmd.ExecuteReader();
        var list = new List<OpenSessionInfo>();
        while (rd.Read())
            list.Add(new OpenSessionInfo(rd.GetInt64(0), rd.GetInt64(1), UnixMs.ToUtc(rd.GetInt64(2)), UnixMs.ToUtc(rd.GetInt64(3))));
        return list;
    }

    /// <summary>
    /// After a crash, power cut or kill: sessions left open are closed at their last heartbeat, so at most one
    /// heartbeat interval of play is lost and nothing is counted twice. Returns how many were closed.
    /// </summary>
    public int RecoverOpenSessions(int minSeconds = 0)
    {
        using var c = db.Connect();
        using var tx = c.BeginTransaction();
        var open = new List<(long Id, long Start, long Beat)>();
        using (var cmd = ShelfDb.Command(c, "SELECT id, started, last_heartbeat FROM sessions WHERE ended IS NULL"))
        using (var rd = cmd.ExecuteReader())
            while (rd.Read()) open.Add((rd.GetInt64(0), rd.GetInt64(1), rd.GetInt64(2)));
        foreach (var (id, start, beat) in open)
            CloseIn(c, id, beat, "heartbeat", discard: (beat - start) / 1000 < minSeconds);
        ShelfDb.Exec(c, "UPDATE watcher_runs SET ended = last_heartbeat WHERE ended IS NULL");
        tx.Commit();
        return open.Count;
    }

    public List<SessionRow> Sessions(long? gameId = null, DateTime? sinceUtc = null, int limit = 500)
    {
        using var c = db.Connect();
        using var cmd = ShelfDb.Command(c, """
            SELECT s.id, s.game_id, g.title, s.started, s.ended, s.last_heartbeat, s.end_reason
            FROM sessions s JOIN games g ON g.id = s.game_id
            WHERE ($g IS NULL OR s.game_id = $g) AND ($since IS NULL OR s.started >= $since)
            ORDER BY s.started DESC LIMIT $limit
            """, ("$g", gameId), ("$since", sinceUtc is null ? null : UnixMs.From(sinceUtc.Value)), ("$limit", limit));
        using var rd = cmd.ExecuteReader();
        var list = new List<SessionRow>();
        while (rd.Read())
        {
            list.Add(new SessionRow(rd.GetInt64(0), rd.GetInt64(1), rd.GetString(2), UnixMs.ToUtc(rd.GetInt64(3)),
                rd.IsDBNull(4) ? null : UnixMs.ToUtc(rd.GetInt64(4)), UnixMs.ToUtc(rd.GetInt64(5)), rd.IsDBNull(6) ? null : rd.GetString(6)));
        }
        return list;
    }

    // --- Watcher runs: when was Shelf tracking at all ----------------------------------------------------------

    public long StartRun(DateTime nowUtc)
    {
        using var c = db.Connect();
        ShelfDb.Exec(c, "INSERT INTO watcher_runs (started, last_heartbeat) VALUES ($t, $t)", ("$t", UnixMs.From(nowUtc)));
        return (long)ShelfDb.Scalar(c, "SELECT last_insert_rowid()")!;
    }

    public void HeartbeatRun(long runId, DateTime nowUtc)
    {
        using var c = db.Connect();
        ShelfDb.Exec(c, "UPDATE watcher_runs SET last_heartbeat = $t WHERE id = $id", ("$t", UnixMs.From(nowUtc)), ("$id", runId));
    }

    public void EndRun(long runId, DateTime nowUtc)
    {
        using var c = db.Connect();
        ShelfDb.Exec(c, "UPDATE watcher_runs SET ended = $t, last_heartbeat = $t WHERE id = $id", ("$t", UnixMs.From(nowUtc)), ("$id", runId));
    }

    public List<WatcherRun> Runs(DateTime sinceUtc)
    {
        using var c = db.Connect();
        using var cmd = ShelfDb.Command(c, "SELECT id, started, last_heartbeat, ended FROM watcher_runs WHERE last_heartbeat >= $s ORDER BY started",
            ("$s", UnixMs.From(sinceUtc)));
        using var rd = cmd.ExecuteReader();
        var list = new List<WatcherRun>();
        while (rd.Read())
            list.Add(new WatcherRun(rd.GetInt64(0), UnixMs.ToUtc(rd.GetInt64(1)), UnixMs.ToUtc(rd.GetInt64(2)), rd.IsDBNull(3) ? null : UnixMs.ToUtc(rd.GetInt64(3))));
        return list;
    }
}
