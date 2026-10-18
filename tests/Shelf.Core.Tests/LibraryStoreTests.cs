using Shelf.Core.Dedup;
using Shelf.Core.Library;
using Shelf.Core.Model;
using Shelf.Core.Tests.Support;

namespace Shelf.Core.Tests;

public class LibraryStoreTests : IDisposable
{
    private readonly TestDb _t = new();
    private readonly FakeClock _clock = new();

    public void Dispose() => _t.Dispose();

    private static InstallRecord R(SourceKind s, string title, string path, int confidence = 100, long? size = 1000) => new()
    {
        Source = s,
        Title = title,
        InstallPath = path,
        Confidence = confidence,
        SizeBytes = size,
        SizeSource = SizeSource.Measured,
    };

    private void Sync(IEnumerable<InstallRecord> library, IEnumerable<InstallRecord>? review = null) =>
        _t.Library.Sync(new LibrarySnapshot { Games = GameMatcher.Merge(library), Review = [.. review ?? []] }, _clock.UtcNow);

    [Fact]
    public void SyncCreatesGamesAndReportsNewOnes()
    {
        var hades = _t.Tree.Dir("Games/Hades");
        var result = _t.Library.Sync(new LibrarySnapshot { Games = GameMatcher.Merge([R(SourceKind.Steam, "Hades", hades)]) }, _clock.UtcNow);
        Assert.Equal(["Hades"], result.NewGames);
        var g = Assert.Single(_t.Library.Games());
        Assert.True(g.Installed);
        Assert.Equal(1000, g.SizeBytes);
        Assert.Equal(["Steam"], g.Sources);
        Assert.Equal(_clock.UtcNow, g.FirstSeen);

        _clock.Advance(TimeSpan.FromHours(1));
        Assert.Empty(_t.Library.Sync(new LibrarySnapshot { Games = GameMatcher.Merge([R(SourceKind.Steam, "Hades", hades)]) }, _clock.UtcNow).NewGames);
    }

    [Fact]
    public void GameKeepsItsRowWhenItsTitleChanges()
    {
        var dir = _t.Tree.Dir("Games/hk");
        Sync([R(SourceKind.Folder, "Hollow Knight v1", dir)]);
        var id = _t.Library.Games().Single().Id;
        _t.Sessions.Close(_t.Sessions.Open(id, null, 1, _clock.UtcNow.AddHours(-1)), _clock.UtcNow, "clean");

        _clock.Advance(TimeSpan.FromMinutes(1));
        Sync([R(SourceKind.Folder, "Hollow Knight", dir)]);
        var g = Assert.Single(_t.Library.Games());
        Assert.Equal(id, g.Id);
        Assert.Equal("Hollow Knight", g.Title);
        Assert.Equal(3600, g.TotalSeconds);
    }

    [Fact]
    public void RenamedTitlesStayRenamed()
    {
        var dir = _t.Tree.Dir("Games/x");
        Sync([R(SourceKind.Folder, "Wrong Name", dir)]);
        var id = _t.Library.Games().Single().Id;
        _t.Library.Rename(id, "Right Name");
        _clock.Advance(TimeSpan.FromMinutes(1));
        Sync([R(SourceKind.Folder, "Wrong Name", dir)]);
        Assert.Equal("Right Name", _t.Library.Games().Single().Title);
    }

    [Fact]
    public void DeletedFoldersAreRemovedButHistoryStays()
    {
        var dir = _t.Tree.Dir("Games/Gone");
        Sync([R(SourceKind.Folder, "Gone", dir)]);
        var id = _t.Library.Games().Single().Id;
        _t.Sessions.Close(_t.Sessions.Open(id, null, 1, _clock.UtcNow.AddMinutes(-30)), _clock.UtcNow, "clean");

        Directory.Delete(dir);
        _clock.Advance(TimeSpan.FromMinutes(1));
        var result = _t.Library.Sync(new LibrarySnapshot(), _clock.UtcNow);

        Assert.Equal(1, result.RemovedInstalls);
        var g = Assert.Single(_t.Library.Games());
        Assert.False(g.Installed);
        Assert.Equal(1800, g.TotalSeconds);
    }

    [Fact]
    public void UnreportedButPresentFoldersAreKept()
    {
        // e.g. the launcher couldn't be read this time, or the drive was briefly busy.
        var dir = _t.Tree.Dir("Games/Still");
        Sync([R(SourceKind.Epic, "Still Here", dir)]);
        _clock.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(0, _t.Library.Sync(new LibrarySnapshot(), _clock.UtcNow).RemovedInstalls);
        Assert.True(_t.Library.Games().Single().Installed);
    }

    [Fact]
    public void DuplicateCopiesAreCounted()
    {
        Sync([R(SourceKind.Steam, "Sekiro", _t.Tree.Dir("Steam/Sekiro"), size: 15), R(SourceKind.Folder, "Sekiro", _t.Tree.Dir("Games/Sekiro"), size: 16)]);
        var g = Assert.Single(_t.Library.Games());
        Assert.Equal(2, g.InstalledCopies);
        Assert.Equal(31, g.SizeBytes);
    }

    [Fact]
    public void ImportedSteamHoursAreKeptSeparately()
    {
        var r = R(SourceKind.Steam, "Portal 2", _t.Tree.Dir("Steam/Portal 2"));
        r.ImportedPlaySeconds = 7200;
        r.ImportedLastPlayed = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);
        Sync([r]);
        var g = _t.Library.Games().Single();
        Assert.Equal(7200, g.ImportedSeconds);
        Assert.Equal(0, g.TotalSeconds);
        Assert.Equal(7200, g.PlaySeconds);
        Assert.Equal(new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc), g.LastPlayedAny);
    }

    [Fact]
    public void ReviewAcceptMakesAGameAndItStaysOne()
    {
        var dir = _t.Tree.Dir("Games/Mystery");
        var review = R(SourceKind.Folder, "Mystery", dir, confidence: 45);
        review.LaunchExe = Path.Combine(dir, "mystery.exe");
        Sync([], [review]);
        var d = Assert.Single(_t.Library.PendingDetections());
        Assert.Equal(45, d.Confidence);

        var id = _t.Library.AcceptDetection(d.Id, "Mystery Game", _clock.UtcNow);
        Assert.Empty(_t.Library.PendingDetections());
        _clock.Advance(TimeSpan.FromMinutes(1));
        Sync([], [review]); // the scanner still isn't sure, but you said yes
        Assert.Empty(_t.Library.PendingDetections());
        var g = Assert.Single(_t.Library.Games());
        Assert.Equal(id, g.Id);
        Assert.Equal("Mystery Game", g.Title);
        Assert.True(g.Installed);
    }

    [Fact]
    public void RejectedDetectionsNeverComeBack()
    {
        var dir = _t.Tree.Dir("Tools/Thing");
        var review = R(SourceKind.Folder, "Thing", dir, confidence: 40);
        Sync([], [review]);
        _t.Library.RejectDetection(_t.Library.PendingDetections().Single().Id, _clock.UtcNow);
        Sync([], [review]);
        Assert.Empty(_t.Library.PendingDetections());
        Assert.Empty(_t.Library.Games());
    }

    [Fact]
    public void RuntimeDetectionsAreRecordedOnce()
    {
        var exe = Path.Combine(_t.Tree.Dir("Stuff/Odd/bin/x64"), "odd.exe");
        var id = _t.Library.AddRuntimeDetection(exe, "Odd", ["Ran fullscreen"], _clock.UtcNow);
        Assert.NotNull(id);
        Assert.Null(_t.Library.AddRuntimeDetection(exe, "Odd", ["again"], _clock.UtcNow));
        var d = Assert.Single(_t.Library.PendingDetections());
        Assert.Equal(_t.Tree.P(@"Stuff\Odd"), d.Path); // bin\x64 walked up to the game folder
    }

    [Fact]
    public void ManualAddUsesTheGameFolder()
    {
        var root = GameFixtures.Unreal(_t.Tree, "Stuff/Stray");
        var shipping = Path.Combine(root, "Hk_project", "Binaries", "Win64", "Stray-Win64-Shipping.exe");
        var id = _t.Library.AddManual(shipping, null, _clock.UtcNow);
        var g = _t.Library.Games().Single();
        Assert.Equal(id, g.Id);
        Assert.Equal("Stray", g.Title);
        Assert.Equal(Core.Platform.PathUtil.Normalize(root), g.PrimaryPath);
        Assert.True(g.SizeBytes > 0);
        Assert.Throws<FileNotFoundException>(() => _t.Library.AddManual(_t.Tree.P("nope.exe"), null, _clock.UtcNow));
    }

    [Fact]
    public void HiddenGamesAreFilteredByDefault()
    {
        Sync([R(SourceKind.Folder, "Secret", _t.Tree.Dir("Games/Secret"))]);
        _t.Library.SetHidden(_t.Library.Games().Single().Id, true);
        Assert.Empty(_t.Library.Games());
        Assert.Single(_t.Library.Games(includeHidden: true));
    }

    [Fact]
    public void SourceStatusIsStored()
    {
        _t.Library.Sync(new LibrarySnapshot
        {
            Sources = [new SourceResult(SourceKind.Epic, SourceState.Unreadable, "Epic manifests not found", [])],
        }, _clock.UtcNow);
        using var c = _t.Db.Connect();
        Assert.Equal("Epic manifests not found", Storage.ShelfDb.Scalar(c, "SELECT message FROM source_status WHERE source = 'Epic'"));
    }
}
