using System.Text;

namespace Shelf.Core.Sources.Vdf;

/// <summary>A Valve KeyValues node: either a string value or a list of children. Lookups ignore case.</summary>
public sealed class VdfNode
{
    public string? Value { get; }
    public List<KeyValuePair<string, VdfNode>> Children { get; } = [];

    public VdfNode(string? value = null) => Value = value;

    public VdfNode? this[string key]
    {
        get
        {
            foreach (var (k, v) in Children)
                if (string.Equals(k, key, StringComparison.OrdinalIgnoreCase)) return v;
            return null;
        }
    }

    /// <summary>Walks a path of keys: <c>node.Path("Software", "Valve", "Steam")</c>.</summary>
    public VdfNode? Path(params string[] keys)
    {
        VdfNode? node = this;
        foreach (var k in keys)
        {
            node = node?[k];
            if (node is null) return null;
        }
        return node;
    }

    public string? Str(string key) => this[key]?.Value;

    public long? Long(string key) => long.TryParse(Str(key), out var v) ? v : null;
}

/// <summary>Parser for the text KeyValues format used by libraryfolders.vdf, appmanifest_*.acf and localconfig.vdf.</summary>
public static class VdfParser
{
    public static VdfNode Parse(string text)
    {
        var pos = 0;
        var root = new VdfNode();
        ParseChildren(text, ref pos, root, topLevel: true);
        return root;
    }

    public static VdfNode ParseFile(string path) => Parse(File.ReadAllText(path));

    private static void ParseChildren(string s, ref int pos, VdfNode parent, bool topLevel)
    {
        while (true)
        {
            var key = NextToken(s, ref pos, out var kind);
            if (kind == TokenKind.End)
            {
                if (!topLevel) throw new FormatException("Unexpected end of VDF: missing '}'");
                return;
            }
            if (kind == TokenKind.Close)
            {
                if (topLevel) throw new FormatException($"Unexpected '}}' at {pos}");
                return;
            }
            if (kind == TokenKind.Open) throw new FormatException($"Unexpected '{{' at {pos}");

            var value = NextToken(s, ref pos, out var valueKind);
            // Conditionals like [$WIN32] after a value are ignored.
            switch (valueKind)
            {
                case TokenKind.String:
                    parent.Children.Add(new(key!, new VdfNode(value)));
                    SkipConditional(s, ref pos);
                    break;
                case TokenKind.Open:
                    var child = new VdfNode();
                    ParseChildren(s, ref pos, child, topLevel: false);
                    parent.Children.Add(new(key!, child));
                    break;
                default:
                    throw new FormatException($"Key '{key}' has no value");
            }
        }
    }

    private enum TokenKind { String, Open, Close, End }

    private static string? NextToken(string s, ref int pos, out TokenKind kind)
    {
        SkipWhitespaceAndComments(s, ref pos);
        if (pos >= s.Length) { kind = TokenKind.End; return null; }
        var c = s[pos];
        if (c == '{') { pos++; kind = TokenKind.Open; return null; }
        if (c == '}') { pos++; kind = TokenKind.Close; return null; }
        kind = TokenKind.String;
        if (c == '"')
        {
            pos++;
            var sb = new StringBuilder();
            while (pos < s.Length && s[pos] != '"')
            {
                if (s[pos] == '\\' && pos + 1 < s.Length)
                {
                    pos++;
                    sb.Append(s[pos] switch { 'n' => '\n', 't' => '\t', 'r' => '\r', var other => other });
                }
                else sb.Append(s[pos]);
                pos++;
            }
            pos++; // closing quote (or end)
            return sb.ToString();
        }
        var start = pos;
        while (pos < s.Length && !char.IsWhiteSpace(s[pos]) && s[pos] is not ('{' or '}' or '"')) pos++;
        return s[start..pos];
    }

    private static void SkipConditional(string s, ref int pos)
    {
        var p = pos;
        while (p < s.Length && s[p] is ' ' or '\t') p++;
        if (p < s.Length && s[p] == '[')
        {
            var end = s.IndexOf(']', p);
            if (end > 0) pos = end + 1;
        }
    }

    private static void SkipWhitespaceAndComments(string s, ref int pos)
    {
        while (pos < s.Length)
        {
            if (char.IsWhiteSpace(s[pos]) || s[pos] == '﻿') { pos++; continue; }
            if (s[pos] == '/' && pos + 1 < s.Length && s[pos + 1] == '/')
            {
                while (pos < s.Length && s[pos] != '\n') pos++;
                continue;
            }
            // #include / #base directives aren't used by the files Shelf reads; skip the line.
            if (s[pos] == '#')
            {
                while (pos < s.Length && s[pos] != '\n') pos++;
                continue;
            }
            return;
        }
    }
}
