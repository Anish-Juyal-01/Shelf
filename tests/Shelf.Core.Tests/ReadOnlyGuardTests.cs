using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

namespace Shelf.Core.Tests;

/// <summary>
/// Enforces the rules in code review form: only Shelf's own storage code may write files, and only metadata code may
/// talk to the network. Detection code reading game folders can't accidentally change them.
/// </summary>
public partial class ReadOnlyGuardTests
{
    private static string CoreDir([CallerFilePath] string here = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "..", "src", "Shelf.Core"));

    private static IEnumerable<(string File, string Rel)> SourceFiles() =>
        Directory.EnumerateFiles(CoreDir(), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .Select(f => (f, Path.GetRelativePath(CoreDir(), f)));

    [Fact]
    public void OnlyStorageCodeWritesFiles()
    {
        var offenders = SourceFiles()
            .Where(f => !f.Rel.StartsWith("Storage" + Path.DirectorySeparatorChar))
            .Where(f => WriteApi().IsMatch(File.ReadAllText(f.File)))
            .Select(f => f.Rel)
            .ToList();
        Assert.True(offenders.Count == 0, "File-writing APIs outside Storage/: " + string.Join(", ", offenders));
    }

    [Fact]
    public void OnlyMetadataCodeUsesTheNetwork()
    {
        var offenders = SourceFiles()
            .Where(f => !f.Rel.StartsWith("Metadata" + Path.DirectorySeparatorChar))
            .Where(f => NetworkApi().IsMatch(File.ReadAllText(f.File)))
            .Select(f => f.Rel)
            .ToList();
        Assert.True(offenders.Count == 0, "Network APIs outside Metadata/: " + string.Join(", ", offenders));
    }

    [Fact]
    public void GuardActuallySeesTheSource() => Assert.True(SourceFiles().Count() > 20);

    [GeneratedRegex(@"File\.(Write|Delete|Move|Copy|Create|Replace|Append|SetAttributes|SetLastWrite|SetCreation|Encrypt)|Directory\.(Delete|Move|CreateDirectory|SetLastWrite)|FileMode\.(Create|CreateNew|Append|Truncate|OpenOrCreate)|FileAccess\.(Write|ReadWrite)|\.Delete\(|\.MoveTo\(|\.CopyTo\(")]
    private static partial Regex WriteApi();

    [GeneratedRegex(@"HttpClient|WebClient|WebRequest|TcpClient|Socket\b|System\.Net\.Http")]
    private static partial Regex NetworkApi();
}
