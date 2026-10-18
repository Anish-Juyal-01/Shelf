using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Shelf.Core.Naming;

/// <summary>Turns folder and exe names like <c>Hollow_Knight_v1.5.78 [FitGirl Repack]</c> into <c>Hollow Knight</c>.</summary>
public static partial class NameCleaner
{
    /// <summary>Release groups, repackers and distribution tags that never belong in a title.</summary>
    private const string Groups =
        "FitGirl|DODI|ElAmigos|El Amigos|CODEX|EMPRESS|RUNE|TENOKE|PLAZA|SKIDROW|RELOADED|CPY|FLT|FLT-?Fairlight|DARKSiDERS|HOODLUM|"
        + "Razor1911|GOLDBERG|P2P|KaOs|xatab|Chovka|R\\.G\\. ?Mechanics|R\\.G\\.|Mechanics|SiMPLEX|PROPHET|TiNYiSO|DOGE|ANOMALY|"
        + "I_KnoW|Kaos|GOG|Steam ?Rip|SteamRIP|Repack|Repacked|Portable|Pre-?Installed|Cracked|Crack|MULTi\\d*|Multi ?\\d+|"
        + "x64|x86|64-?bit|32-?bit|Win64|Win32|DRM-?Free|Free Download|Online Fix|OnlineFix";

    public static string Clean(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var s = raw.Trim();

        if (s.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) s = s[..^4];
        s = ShippingSuffix().Replace(s, "");

        // Everything in brackets is tags: [FitGirl Repack], (2018), {GOG}, (v1.2).
        s = Brackets().Replace(s, " ");

        // Separators: underscores always; dots when they join words (not inside version numbers, handled next).
        s = s.Replace('_', ' ');
        s = Version().Replace(s, " ");
        s = WordDots().Replace(s, " ");
        s = GroupTag().Replace(s, " ");
        s = Version().Replace(s, " ");
        s = TrailingDashTag().Replace(s, "");

        s = SplitCamel(s);
        s = Spaces().Replace(s, " ").Trim();
        s = s.Trim(' ', '-', '–', ':', ',', '.', '+', '&');
        s = FixCase(s);
        return s.Length > 0 ? s : raw.Trim();
    }

    /// <summary>Key for de-duplication: lower-case letters and digits only, trademark signs and a leading "the" dropped.</summary>
    public static string Key(string title)
    {
        var s = Clean(title).ToLowerInvariant().Replace("&", "and");
        if (s.StartsWith("the ")) s = s[4..];
        var sb = new StringBuilder(s.Length);
        foreach (var c in s.Normalize(NormalizationForm.FormD))
        {
            if (char.IsLetterOrDigit(c) && CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        }
        return sb.ToString();
    }

    private static string SplitCamel(string s)
    {
        // Only for squashed names (HollowKnight, Cyberpunk2077); anything with spaces already is left alone.
        if (s.Contains(' ') || s.Length < 4) return s;
        s = CamelBoundary().Replace(s, " ");
        s = LetterDigit().Replace(s, " ");
        return s;
    }

    private static readonly HashSet<string> Roman = new(StringComparer.OrdinalIgnoreCase)
        { "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII" };

    private static readonly HashSet<string> SmallWords = new(StringComparer.OrdinalIgnoreCase)
        { "of", "the", "and", "a", "an", "in", "on", "to", "for", "at", "or" };

    private static string FixCase(string s)
    {
        var letters = s.Where(char.IsLetter).ToList();
        if (letters.Count == 0) return s;
        var allUpper = letters.All(char.IsUpper);
        var allLower = letters.All(char.IsLower);
        if (!allUpper && !allLower) return s;

        var words = s.Split(' ');
        for (var i = 0; i < words.Length; i++)
        {
            var w = words[i];
            if (w.Length == 0) continue;
            if (Roman.Contains(w)) { words[i] = w.ToUpperInvariant(); continue; }
            // Short all-caps words are usually acronyms (GTA, FEZ, DLC); keep them.
            if (allUpper && w.Length <= 3) continue;
            if (i > 0 && SmallWords.Contains(w)) { words[i] = w.ToLowerInvariant(); continue; }
            words[i] = char.ToUpperInvariant(w[0]) + w[1..].ToLowerInvariant();
        }
        return string.Join(' ', words);
    }

    [GeneratedRegex(@"-Win(64|32)-Shipping$", RegexOptions.IgnoreCase)]
    private static partial Regex ShippingSuffix();

    [GeneratedRegex(@"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}")]
    private static partial Regex Brackets();

    /// <summary>v1.2.3, version 1.05, Build 12345, Update 4, rev123, and bare dotted versions like 1.4.4.9.</summary>
    [GeneratedRegex(@"(?<![\p{L}\d])(v\s?\d+(\.\d+)*[a-z]?|version\s?\d+(\.\d+)*|build\s?\d+(\.\d+)*|update\s?\d+(\.\d+)*|rev\s?\d+|\d+\.\d+\.\d+(\.\d+)*)(?![\p{L}\d])", RegexOptions.IgnoreCase)]
    private static partial Regex Version();

    [GeneratedRegex(@"(?<=[\p{L}\d])\.(?=[\p{L}\d])")]
    private static partial Regex WordDots();

    [GeneratedRegex(@"(?<![\p{L}\d])(" + Groups + @")(?![\p{L}\d])", RegexOptions.IgnoreCase)]
    private static partial Regex GroupTag();

    /// <summary>A dangling " - " or "-" left after removing a tag at the end.</summary>
    [GeneratedRegex(@"(\s*[-–]\s*)+$")]
    private static partial Regex TrailingDashTag();

    [GeneratedRegex(@"(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})")]
    private static partial Regex CamelBoundary();

    [GeneratedRegex(@"(?<=\p{L}{2})(?=\d)")]
    private static partial Regex LetterDigit();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
