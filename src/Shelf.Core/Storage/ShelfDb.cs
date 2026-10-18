using Microsoft.Data.Sqlite;

namespace Shelf.Core.Storage;

/// <summary>
/// Shelf's database (<c>%APPDATA%\Shelf\shelf.db</c>, WAL). Timestamps are unix milliseconds (UTC). Connections are
/// short-lived and pooled; SQLite serialises writers, and every multi-row write runs in a transaction.
/// </summary>
public sealed class ShelfDb
{
    public const int SchemaVersion = 1;

    private readonly string _connectionString;

    public string Path { get; }

    public ShelfDb(string path)
    {
        Path = path;
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            DefaultTimeout = 10,
        }.ToString();
        Migrate();
    }

    public static ShelfDb Open(ShelfPaths paths) => new(System.IO.Path.Combine(paths.DataDir, "shelf.db"));

    public SqliteConnection Connect()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;";
        cmd.ExecuteNonQuery();
        return c;
    }

    private void Migrate()
    {
        using var c = Connect();
        Exec(c, "PRAGMA journal_mode = WAL;");
        var version = Convert.ToInt32(Scalar(c, "PRAGMA user_version;"));
        if (version >= SchemaVersion) return;

        using var tx = c.BeginTransaction();
        Exec(c, """
            CREATE TABLE IF NOT EXISTS games (
                id                       INTEGER PRIMARY KEY,
                key                      TEXT NOT NULL UNIQUE,
                title                    TEXT NOT NULL,
                title_locked             INTEGER NOT NULL DEFAULT 0,
                hidden                   INTEGER NOT NULL DEFAULT 0,
                first_seen               INTEGER NOT NULL,
                last_played              INTEGER,
                total_seconds            INTEGER NOT NULL DEFAULT 0,
                imported_seconds         INTEGER NOT NULL DEFAULT 0,
                imported_last_played     INTEGER
            );
            CREATE TABLE IF NOT EXISTS installs (
                id                INTEGER PRIMARY KEY,
                game_id           INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                source            TEXT NOT NULL,
                source_key        TEXT,
                install_path      TEXT NOT NULL,
                path_key          TEXT NOT NULL UNIQUE,
                launch_exe        TEXT,
                working_dir       TEXT,
                launch_uri        TEXT,
                launch_args       TEXT,
                uninstall_command TEXT,
                size_bytes        INTEGER,
                size_source       TEXT,
                state             TEXT NOT NULL,      -- installed | missing | removed
                confidence        INTEGER NOT NULL,
                signals           TEXT,
                first_seen        INTEGER NOT NULL,
                last_seen         INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_installs_game ON installs(game_id);
            CREATE TABLE IF NOT EXISTS game_exes (
                exe_key   TEXT PRIMARY KEY,
                exe_path  TEXT NOT NULL,
                game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id              INTEGER PRIMARY KEY,
                game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                exe_path        TEXT,
                pid             INTEGER,
                started         INTEGER NOT NULL,
                ended           INTEGER,
                last_heartbeat  INTEGER NOT NULL,
                end_reason      TEXT                  -- clean | heartbeat | suspend | app_exit
            );
            CREATE INDEX IF NOT EXISTS ix_sessions_game ON sessions(game_id, started);
            CREATE INDEX IF NOT EXISTS ix_sessions_started ON sessions(started);
            CREATE TABLE IF NOT EXISTS detections (
                id              INTEGER PRIMARY KEY,
                path_key        TEXT NOT NULL UNIQUE,
                path            TEXT NOT NULL,
                exe             TEXT,
                origin          TEXT NOT NULL,        -- scan | installed_apps | runtime
                signals         TEXT,
                confidence      INTEGER NOT NULL,
                suggested_title TEXT NOT NULL,
                size_bytes      INTEGER,
                state           TEXT NOT NULL,        -- pending | accepted | rejected
                found           INTEGER NOT NULL,
                last_seen       INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ignored (
                key    TEXT PRIMARY KEY,              -- path key of a folder or exe the user said isn't a game
                added  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS source_status (
                source      TEXT PRIMARY KEY,
                state       TEXT NOT NULL,
                message     TEXT NOT NULL,
                games_found INTEGER NOT NULL,
                checked     INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS watcher_runs (
                id              INTEGER PRIMARY KEY,
                started         INTEGER NOT NULL,
                last_heartbeat  INTEGER NOT NULL,
                ended           INTEGER
            );
            """);
        Exec(c, $"PRAGMA user_version = {SchemaVersion};");
        tx.Commit();
    }

    internal static void Exec(SqliteConnection c, string sql, params (string Name, object? Value)[] args)
    {
        using var cmd = Command(c, sql, args);
        cmd.ExecuteNonQuery();
    }

    internal static object? Scalar(SqliteConnection c, string sql, params (string Name, object? Value)[] args)
    {
        using var cmd = Command(c, sql, args);
        var v = cmd.ExecuteScalar();
        return v is DBNull ? null : v;
    }

    internal static SqliteCommand Command(SqliteConnection c, string sql, params (string Name, object? Value)[] args)
    {
        var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }
}
