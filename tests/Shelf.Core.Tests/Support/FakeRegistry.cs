using Shelf.Core.Platform;

namespace Shelf.Core.Tests.Support;

public sealed class FakeRegistry : IRegistryView
{
    private readonly Dictionary<string, Dictionary<string, string>> _keys = new(StringComparer.OrdinalIgnoreCase);

    public FakeRegistry Set(string path, string name, string value)
    {
        if (!_keys.TryGetValue(path, out var values)) _keys[path] = values = new(StringComparer.OrdinalIgnoreCase);
        values[name] = value;
        return this;
    }

    public FakeRegistry Key(string path, params (string Name, string Value)[] values)
    {
        if (!_keys.ContainsKey(path)) _keys[path] = new(StringComparer.OrdinalIgnoreCase);
        foreach (var (n, v) in values) Set(path, n, v);
        return this;
    }

    public IReadOnlyList<string> GetSubKeyNames(string path)
    {
        var prefix = path.TrimEnd('\\') + "\\";
        return _keys.Keys
            .Where(k => k.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .Select(k => k[prefix.Length..].Split('\\')[0])
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public string? GetValue(string path, string name) =>
        _keys.TryGetValue(path, out var values) && values.TryGetValue(name, out var v) ? v : null;
}

public static class TestContext
{
    public static SystemContext For(TempTree tree, FakeRegistry? registry = null) => new()
    {
        Registry = registry ?? new FakeRegistry(),
        ProgramData = tree.Dir("ProgramData"),
        AppData = tree.Dir("AppData"),
        LocalAppData = tree.Dir("LocalAppData"),
        ProgramFiles = tree.Dir("Program Files"),
        ProgramFilesX86 = tree.Dir("Program Files (x86)"),
        UserProfile = tree.Dir("User"),
        FixedDrives = [tree.Dir("drive")],
    };
}
