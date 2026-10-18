using Microsoft.Data.Sqlite;

namespace Shelf.Core.Storage;

/// <summary>
/// Opens another app's SQLite database without touching it: the file (and its -wal journal) is copied to a temp
/// folder and the copy is opened read-only. Opening the original, even read-only, could take locks the owning
/// launcher doesn't expect.
/// </summary>
public sealed class SqliteSnapshot : IDisposable
{
    private readonly string _dir;

    public SqliteConnection Connection { get; }

    private SqliteSnapshot(string dir, SqliteConnection connection)
    {
        _dir = dir;
        Connection = connection;
    }

    public static SqliteSnapshot Open(string databasePath)
    {
        var dir = Path.Combine(Path.GetTempPath(), "Shelf", "snap-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var copy = Path.Combine(dir, Path.GetFileName(databasePath));
        CopyShared(databasePath, copy);
        foreach (var suffix in new[] { "-wal", "-shm" })
            if (File.Exists(databasePath + suffix)) CopyShared(databasePath + suffix, copy + suffix);

        var conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = copy, Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
        conn.Open();
        return new SqliteSnapshot(dir, conn);
    }

    /// <summary>Copies a file another process may hold open for writing.</summary>
    private static void CopyShared(string from, string to)
    {
        using var src = new FileStream(from, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var dst = new FileStream(to, FileMode.CreateNew, FileAccess.Write);
        src.CopyTo(dst);
    }

    public void Dispose()
    {
        Connection.Dispose();
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
