using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Microsoft.Data.Sqlite;
using Shelf.Core.Model;
using Shelf.Core.Platform;
using Shelf.Core.Storage;

namespace Shelf.Core.Sources;

/// <summary>
/// Xbox app / PC Game Pass: each drive's <c>.GamingRoot</c> names its games folder (default <c>XboxGames</c>);
/// every game has <c>Content\MicrosoftGame.config</c>.
/// </summary>
public sealed class XboxReader : ISourceReader
{
    public SourceKind Kind => SourceKind.Xbox;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var installs = new List<InstallRecord>();
        var roots = 0;
        foreach (var drive in ctx.FixedDrives)
        {
            foreach (var folder in ReadGamingRoot(drive))
            {
                var dir = Path.Combine(drive, folder);
                if (!Directory.Exists(dir)) continue;
                roots++;
                foreach (var game in EaReader.SafeDirs(dir))
                {
                    ct.ThrowIfCancellationRequested();
                    var config = Path.Combine(game, "Content", "MicrosoftGame.config");
                    if (!File.Exists(config)) continue;
                    var r = ReadConfig(config, game);
                    if (r is not null) installs.Add(r);
                }
            }
        }
        if (roots == 0) return SourceResult.NotInstalled(Kind, "No Xbox games folder on any drive");
        return new SourceResult(Kind, SourceState.Ok, SourceReaders.Plural(installs.Count, "game"), installs);
    }

    /// <summary><c>.GamingRoot</c>: "RGBX", a uint32 count, then null-terminated UTF-16 folder paths relative to the drive.</summary>
    internal static List<string> ReadGamingRoot(string drive)
    {
        var file = Path.Combine(drive, ".GamingRoot");
        var result = new List<string>();
        try
        {
            if (File.Exists(file))
            {
                var bytes = File.ReadAllBytes(file);
                if (bytes.Length > 8 && Encoding.ASCII.GetString(bytes, 0, 4) == "RGBX")
                {
                    var text = Encoding.Unicode.GetString(bytes, 8, (bytes.Length - 8) / 2 * 2);
                    result.AddRange(text.Split('\0', StringSplitOptions.RemoveEmptyEntries).Select(s => s.TrimStart('\\')));
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        if (result.Count == 0) result.Add("XboxGames");
        return result;
    }

    internal static InstallRecord? ReadConfig(string configPath, string gameDir)
    {
        XDocument doc;
        try { doc = XDocument.Load(configPath); }
        catch (Exception e) when (e is IOException or System.Xml.XmlException or UnauthorizedAccessException) { return null; }

        XElement? El(string name) => doc.Descendants().FirstOrDefault(e => e.Name.LocalName == name);
        var identity = El("Identity");
        var visuals = El("ShellVisuals");
        var exeEl = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "Executable");
        var name = (string?)visuals?.Attribute("DefaultDisplayName");
        if (string.IsNullOrWhiteSpace(name) || name.StartsWith("ms-resource:", StringComparison.OrdinalIgnoreCase))
            name = Path.GetFileName(gameDir);

        var content = Path.Combine(gameDir, "Content");
        var exeName = (string?)exeEl?.Attribute("Name");
        var record = new InstallRecord
        {
            Source = SourceKind.Xbox,
            SourceKey = (string?)identity?.Attribute("Name"),
            Title = name,
            InstallPath = PathUtil.Normalize(gameDir),
            LaunchExe = exeName is null ? null : Path.Combine(content, exeName),
            UninstallCommand = "ms-settings:appsfeatures",
        };
        var idName = (string?)identity?.Attribute("Name");
        var publisher = (string?)identity?.Attribute("Publisher");
        var appId = (string?)exeEl?.Attribute("Id");
        if (idName is not null && publisher is not null && appId is not null)
            record.LaunchUri = $@"shell:AppsFolder\{idName}_{PublisherId(publisher)}!{appId}";
        if (record.LaunchExe is not null) record.PlayExes.Add(record.LaunchExe);
        return record;
    }

    /// <summary>
    /// The 13-character publisher id in a package family name: SHA-256 of the UTF-16 publisher string, first 8 bytes,
    /// read as 65 bits (64 + a zero pad bit) in Crockford base32.
    /// </summary>
    internal static string PublisherId(string publisher)
    {
        const string alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
        var hash = SHA256.HashData(Encoding.Unicode.GetBytes(publisher));
        var bits = new StringBuilder(65);
        for (var i = 0; i < 8; i++) bits.Append(Convert.ToString(hash[i], 2).PadLeft(8, '0'));
        bits.Append('0');
        var sb = new StringBuilder(13);
        for (var i = 0; i < 65; i += 5) sb.Append(alphabet[Convert.ToInt32(bits.ToString(i, 5), 2)]);
        return sb.ToString();
    }
}

/// <summary>itch app: <c>%APPDATA%\itch\db\butler.db</c> (caves = installs).</summary>
public sealed class ItchReader : ISourceReader
{
    public SourceKind Kind => SourceKind.Itch;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var db = Path.Combine(ctx.AppData, "itch", "db", "butler.db");
        if (!File.Exists(db))
            return Directory.Exists(Path.Combine(ctx.AppData, "itch"))
                ? SourceResult.Unreadable(Kind, "itch is installed but butler.db wasn't found")
                : SourceResult.NotInstalled(Kind, "itch isn't installed");
        try
        {
            using var snap = SqliteSnapshot.Open(db);
            using var cmd = snap.Connection.CreateCommand();
            cmd.CommandText = """
                SELECT c.id, g.title, c.install_folder_name, l.path, g.classification
                FROM caves c
                JOIN games g ON g.id = c.game_id
                LEFT JOIN install_locations l ON l.id = c.install_location_id
                """;
            using var reader = cmd.ExecuteReader();
            var installs = new List<InstallRecord>();
            while (reader.Read())
            {
                var classification = reader.IsDBNull(4) ? "game" : reader.GetString(4);
                if (!classification.Equals("game", StringComparison.OrdinalIgnoreCase)) continue;
                if (reader.IsDBNull(2) || reader.IsDBNull(3)) continue;
                var location = reader.GetString(3);
                var folder = reader.GetString(2);
                var path = Path.Combine(location, folder);
                if (!Directory.Exists(path) && Directory.Exists(Path.Combine(location, "apps", folder)))
                    path = Path.Combine(location, "apps", folder);
                var caveId = reader.GetString(0);
                installs.Add(new InstallRecord
                {
                    Source = Kind,
                    SourceKey = caveId,
                    Title = reader.IsDBNull(1) ? folder : reader.GetString(1),
                    InstallPath = PathUtil.Normalize(path),
                    LaunchUri = $"itch://caves/{caveId}/launch",
                    IsInstalled = Directory.Exists(path),
                });
            }
            return new SourceResult(Kind, SourceState.Ok, SourceReaders.Plural(installs.Count, "game"), installs);
        }
        catch (Exception e) when (e is SqliteException or IOException or UnauthorizedAccessException or InvalidCastException)
        {
            return SourceResult.Unreadable(Kind, $"itch's database couldn't be read ({e.Message})");
        }
    }
}

/// <summary>Amazon Games: <c>%LOCALAPPDATA%\Amazon Games\Data\Games\Sql\GameInstallInfo.sqlite</c>.</summary>
public sealed class AmazonReader : ISourceReader
{
    public SourceKind Kind => SourceKind.Amazon;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var root = Path.Combine(ctx.LocalAppData, "Amazon Games");
        var db = Path.Combine(root, "Data", "Games", "Sql", "GameInstallInfo.sqlite");
        if (!File.Exists(db))
            return Directory.Exists(root)
                ? SourceResult.Unreadable(Kind, "Amazon Games is installed but GameInstallInfo.sqlite wasn't found")
                : SourceResult.NotInstalled(Kind, "Amazon Games isn't installed");
        try
        {
            using var snap = SqliteSnapshot.Open(db);
            using var cmd = snap.Connection.CreateCommand();
            cmd.CommandText = "SELECT Id, ProductTitle, InstallDirectory FROM DbSet WHERE Installed = 1";
            using var reader = cmd.ExecuteReader();
            var installs = new List<InstallRecord>();
            while (reader.Read())
            {
                if (reader.IsDBNull(2)) continue;
                var id = reader.GetString(0);
                var path = PathUtil.Normalize(reader.GetString(2));
                installs.Add(new InstallRecord
                {
                    Source = Kind,
                    SourceKey = id,
                    Title = reader.IsDBNull(1) ? Path.GetFileName(path) : reader.GetString(1),
                    InstallPath = path,
                    LaunchUri = $"amazon-games://play/{id}",
                    IsInstalled = Directory.Exists(path),
                });
            }
            return new SourceResult(Kind, SourceState.Ok, SourceReaders.Plural(installs.Count, "game"), installs);
        }
        catch (Exception e) when (e is SqliteException or IOException or UnauthorizedAccessException or InvalidCastException)
        {
            return SourceResult.Unreadable(Kind, $"Amazon Games' database couldn't be read ({e.Message})");
        }
    }
}
