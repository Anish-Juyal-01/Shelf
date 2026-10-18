using System.Text;

namespace Shelf.Core.Tests.Support;

/// <summary>A throwaway folder tree for fixtures. File sizes are real but tiny; tests shrink the classifier's thresholds.</summary>
public sealed class TempTree : IDisposable
{
    public string Root { get; }

    public TempTree()
    {
        Root = Path.Combine(Path.GetTempPath(), "shelf-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);
    }

    public string P(string relative) => Path.Combine(Root, relative);

    public string File(string relative, int bytes = 16)
    {
        var path = P(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        System.IO.File.WriteAllBytes(path, new byte[bytes]);
        return path;
    }

    public string Text(string relative, string content)
    {
        var path = P(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        System.IO.File.WriteAllText(path, content, Encoding.UTF8);
        return path;
    }

    public string Dir(string relative)
    {
        var path = P(relative);
        Directory.CreateDirectory(path);
        return path;
    }

    public void Dispose()
    {
        try { Directory.Delete(Root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
