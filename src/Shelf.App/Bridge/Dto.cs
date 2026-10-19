using System.Text.Json;
using System.Text.Json.Serialization;
using Shelf.Core.Model;

namespace Shelf.App.Bridge;

// Shapes sent to the UI. They mirror ui/src/bridge/protocol.ts exactly (camelCase, enums as camelCase strings).

internal static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };
}

internal sealed record GameDto(
    long Id, string Title, IReadOnlyList<SourceKind> Sources, bool Installed, bool Hidden, long SizeBytes, int Copies,
    long PlaySeconds, long TrackedSeconds, long ImportedSeconds, DateTime? LastPlayed, DateTime FirstSeen, string? Path,
    bool CanLaunch, IReadOnlyList<string> Genres, int? Year, string? CoverUrl, string? HeroUrl, string? LogoUrl, string? IconUrl);

internal sealed record InstallDto(long Id, SourceKind Source, string Path, string? LaunchExe, string State, long? SizeBytes,
    int Confidence, IReadOnlyList<string> Signals, string? UninstallLabel);

internal sealed record SessionDto(long Id, long GameId, string Title, DateTime Start, DateTime? End, long Seconds, string? Reason);

internal sealed record GameDetailDto(GameDto Game, IReadOnlyList<InstallDto> Installs, IReadOnlyList<SessionDto> Sessions);

internal sealed record DetectionDto(long Id, string Title, string Path, string? Exe, string Origin, int Confidence, long? SizeBytes,
    IReadOnlyList<string> Signals, DateTime Found);

internal sealed record SourceDto(SourceKind Source, string Name, SourceState State, string Message, int Count);

internal sealed record LeftoverDto(string Path, string Kind, string Title, long SizeBytes);

internal sealed record DriveDto(string Root, string Label, long TotalBytes, long FreeBytes, long GamesBytes);

internal sealed record ScanStatusDto(bool Running, string? Phase, int Dirs, string? Path, DateTime? LastRun, double? LastSeconds, string? Error);

internal sealed record RootDto(string Path, bool Reachable);

internal sealed record SettingsDto(string Theme, string HeroStyle, IReadOnlyList<RootDto> ScanRoots, IReadOnlyList<string> SuggestedRoots, IReadOnlyList<string> Drives,
    bool RuntimeDetection, bool WatchFolders, bool StartWithWindows, bool CloseToTray, string DataDir);

internal sealed record PlayingDto(long GameId, DateTime Since);

internal sealed record GapDto(DateTime Start, DateTime End);

internal sealed record WatchDto(bool Running, bool GpuCounters, DateTime? TrackingSince);

internal sealed record AppStateDto(
    IReadOnlyList<GameDto> Games, IReadOnlyList<DetectionDto> Review, IReadOnlyList<SourceDto> Sources, IReadOnlyList<LeftoverDto> Leftovers,
    IReadOnlyList<DriveDto> Drives, ScanStatusDto Scan, SettingsDto Settings, IReadOnlyList<PlayingDto> Playing,
    IReadOnlyList<SessionDto> Sessions, IReadOnlyList<GapDto> Gaps, WatchDto Watch);

/// <summary>Something worth telling the user. Toasts are shown as Windows notifications when the window isn't in front.</summary>
internal sealed record HostNotice(string Tone, string Text, string? View = null, long? GameId = null, bool Toast = false, string? ToastTitle = null);
