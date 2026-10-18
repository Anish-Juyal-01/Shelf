using Shelf.Core.Platform;
using Shelf.Core.Storage;
using Shelf.Core.Watching;

namespace Shelf.Core.Tests.Support;

public sealed class FakeClock(DateTime start) : IClock
{
    public DateTime UtcNow { get; set; } = start;

    public FakeClock() : this(new DateTime(2026, 10, 18, 18, 0, 0, DateTimeKind.Utc)) { }

    public void Advance(TimeSpan t) => UtcNow += t;
}

public sealed class FakeProcesses : IProcessSource
{
    public List<ProcInfo> Running { get; } = [];

    public IReadOnlyList<ProcInfo> Snapshot() => [.. Running];
}

public sealed class FakeForeground : IForegroundProbe
{
    public ForegroundWindow? Window { get; set; }

    public ForegroundWindow? Current() => Window;
}

public sealed class FakeGpu : IGpuSampler
{
    public double? Value { get; set; }
    public bool Available => true;
    public double? Sample(int pid) => Value;
    public void Dispose() { }
}

/// <summary>A temp folder with a fresh Shelf database.</summary>
public sealed class TestDb : IDisposable
{
    public TempTree Tree { get; } = new();
    public ShelfDb Db { get; }
    public LibraryStore Library { get; }
    public SessionStore Sessions { get; }

    public TestDb()
    {
        Db = new ShelfDb(Tree.P("data/shelf.db"));
        Library = new LibraryStore(Db);
        Sessions = new SessionStore(Db);
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Tree.Dispose();
    }
}
