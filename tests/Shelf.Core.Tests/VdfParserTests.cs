using Shelf.Core.Sources.Vdf;

namespace Shelf.Core.Tests;

public class VdfParserTests
{
    [Fact]
    public void ParsesNestedKeysCaseInsensitively()
    {
        var root = VdfParser.Parse("""
            "AppState"
            {
                "appid"     "620"
                "name"      "Portal 2"
                "UserConfig" { "language" "english" }
            }
            """);
        var state = root["appstate"]!;
        Assert.Equal("620", state.Str("APPID"));
        Assert.Equal("Portal 2", state.Str("name"));
        Assert.Equal("english", state.Path("UserConfig", "language")!.Value);
        Assert.Equal(620, state.Long("appid"));
    }

    [Fact]
    public void HandlesEscapesCommentsAndConditionals()
    {
        var root = VdfParser.Parse("""
            // comment line
            "libraryfolders"
            {
                "0"   // trailing comment
                {
                    "path"  "D:\\SteamLibrary"
                    "label" "say \"hi\""
                    "flag"  "1" [$WIN32]
                }
            }
            """);
        var lib = root.Path("libraryfolders", "0")!;
        Assert.Equal(@"D:\SteamLibrary", lib.Str("path"));
        Assert.Equal("say \"hi\"", lib.Str("label"));
        Assert.Equal("1", lib.Str("flag"));
    }

    [Fact]
    public void UnquotedTokensAndEmptyBlocks()
    {
        var root = VdfParser.Parse("Root { key value\n InstalledDepots { } }");
        Assert.Equal("value", root.Path("Root", "key")!.Value);
        Assert.Empty(root.Path("Root", "InstalledDepots")!.Children);
    }

    [Fact]
    public void MissingCloseBraceThrows()
    {
        Assert.Throws<FormatException>(() => VdfParser.Parse("\"a\" { \"b\" \"c\""));
    }
}
