namespace Shelf.Core.Platform;

/// <summary>Everything the readers need from the machine, so tests can point them at fixture folders.</summary>
public sealed class SystemContext
{
    public required IRegistryView Registry { get; init; }
    public required string ProgramData { get; init; }
    public required string AppData { get; init; }
    public required string LocalAppData { get; init; }
    public required string ProgramFiles { get; init; }
    public required string ProgramFilesX86 { get; init; }
    public required string UserProfile { get; init; }

    /// <summary>Roots of fixed drives, e.g. <c>C:\</c>.</summary>
    public required IReadOnlyList<string> FixedDrives { get; init; }

    public static SystemContext Real() => new()
    {
        Registry = new WindowsRegistryView(),
        ProgramData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        AppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        LocalAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        ProgramFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        ProgramFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
        UserProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        FixedDrives = DriveInfo.GetDrives()
            .Where(d => d.DriveType == DriveType.Fixed && d.IsReady)
            .Select(d => d.RootDirectory.FullName)
            .ToList(),
    };
}
