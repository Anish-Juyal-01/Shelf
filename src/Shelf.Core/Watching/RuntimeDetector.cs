using Shelf.Core.Platform;
using Shelf.Core.Scanning;

namespace Shelf.Core.Watching;

public sealed class RuntimeDetectorOptions
{
    /// <summary>How long an unknown program must look like a game before Shelf asks.</summary>
    public TimeSpan Sustain { get; init; } = TimeSpan.FromSeconds(60);

    /// <summary>3D-engine GPU use that counts as "playing" for windowed games.</summary>
    public double GpuThreshold { get; init; } = 35;
}

public sealed record RuntimeCandidate(int Pid, string ExePath, bool Fullscreen, double? Gpu3D);

/// <summary>
/// Flags an unknown program that stays in the foreground, fullscreen or with sustained 3D GPU use, for a minute.
/// Pure logic: the watcher feeds it one observation per poll.
/// </summary>
public sealed class RuntimeDetector(IClock clock, RuntimeDetectorOptions? options = null)
{
    private readonly RuntimeDetectorOptions _o = options ?? new RuntimeDetectorOptions();
    private readonly HashSet<string> _suggested = new(StringComparer.OrdinalIgnoreCase);
    private string? _exe;
    private DateTime _since;
    private bool _sawFullscreen;
    private double _peakGpu;

    /// <summary>Programs that go fullscreen or use the GPU without being games.</summary>
    private static readonly HashSet<string> NotGames = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "applicationframehost", "lockapp", "searchhost", "searchapp", "shellexperiencehost", "textinputhost",
        "startmenuexperiencehost", "dwm", "msedgewebview2", "windowsterminal", "conhost", "cmd", "powershell", "pwsh",
        "vlc", "mpc-hc", "mpc-hc64", "mpc-be", "mpc-be64", "potplayer", "potplayermini", "potplayermini64", "mpv", "wmplayer",
        "video.ui", "microsoft.media.player", "netflix", "powerpnt", "acrord32", "acrobat", "photoshop", "afterfx",
        "adobe premiere pro", "lightroom", "davinci resolve", "obs64", "streamlabs obs", "slack", "whatsapp", "telegram",
        "ms-teams", "teams", "zoom", "spotify", "rider64", "pycharm64", "clion64", "webstorm64", "shelf", "shelf-cli",
        "nvidia overlay", "nvidia app", "gamebar", "gamebarftserver", "xboxpcapp", "steamwebhelper", "epicwebhelper",
        "eadesktop", "upc", "galaxyclient", "battle.net", "riotclientux", "hoyoplay", "launcher", "parsecd", "moonlight",
        "sunshine", "screenclippinghost", "snippingtool", "magnify", "photos", "microsoft.photos",
    };

    /// <summary>Exes that are never worth asking about.</summary>
    public static bool IsExcluded(string exePath)
    {
        var name = Path.GetFileName(exePath);
        if (ExeClassifier.IsNoise(name) || ExeClassifier.IsKnownApp(name) || NotGames.Contains(ExeClassifier.Stem(name))) return true;
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        return windows.Length > 0 && PathUtil.IsSameOrInside(exePath, windows);
    }

    /// <summary>Returns the exe to suggest when one crosses the threshold (once per exe); null otherwise.</summary>
    public string? Observe(RuntimeCandidate? candidate)
    {
        var now = clock.UtcNow;
        var qualifies = candidate is not null && (candidate.Fullscreen || candidate.Gpu3D >= _o.GpuThreshold);
        if (!qualifies)
        {
            // A null GPU reading right after switching processes isn't evidence either way; keep the streak.
            if (candidate is not null && candidate.ExePath.Equals(_exe, StringComparison.OrdinalIgnoreCase) && candidate.Gpu3D is null && !candidate.Fullscreen)
                return null;
            _exe = null;
            return null;
        }
        if (!candidate!.ExePath.Equals(_exe, StringComparison.OrdinalIgnoreCase))
        {
            _exe = candidate.ExePath;
            _since = now;
            _sawFullscreen = false;
            _peakGpu = 0;
        }
        _sawFullscreen |= candidate.Fullscreen;
        _peakGpu = Math.Max(_peakGpu, candidate.Gpu3D ?? 0);
        if (now - _since < _o.Sustain || !_suggested.Add(candidate.ExePath)) return null;
        return candidate.ExePath;
    }

    /// <summary>Why the last suggestion was made, for the Review list.</summary>
    public List<string> LastSignals(TimeSpan duration) =>
    [
        _sawFullscreen ? $"Ran fullscreen for {duration.TotalSeconds:0}s+" : $"Used the GPU for {duration.TotalSeconds:0}s+ (peak {_peakGpu:0}%)",
        "Seen running, not found by any launcher or scan",
    ];
}
