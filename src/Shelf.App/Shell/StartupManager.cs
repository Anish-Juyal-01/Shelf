using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Principal;
using System.Xml.Linq;

namespace Shelf.App.Shell;

/// <summary>
/// "Start with Windows" as a per-user Task Scheduler task with a sign-in trigger (no admin rights). Explorer's Run
/// key can skip newly added apps for days; a sign-in task runs reliably. Same approach as Waypoint.
/// </summary>
internal sealed class StartupManager(string name = "Shelf")
{
    public const string MinimizedArg = "--minimized";
    private static readonly XNamespace TaskNs = "http://schemas.microsoft.com/windows/2004/02/mit/task";
    private const int TaskCreateOrUpdate = 6;
    private const int TaskLogonInteractiveToken = 3;

    public string ExecutablePath => Environment.ProcessPath ?? throw new InvalidOperationException("Unknown process path.");

    private (string? Command, bool Enabled)? _cached;
    private DateTime _readAt = DateTime.MinValue;

    public bool IsEnabled
    {
        get
        {
            if (DateTime.UtcNow - _readAt > TimeSpan.FromSeconds(30))
            {
                _cached = ReadTask();
                _readAt = DateTime.UtcNow;
            }
            return _cached is { Enabled: true } t && string.Equals(Path.GetFullPath(t.Command ?? ""), ExecutablePath, StringComparison.OrdinalIgnoreCase);
        }
    }

    public void SetEnabled(bool enabled)
    {
        _readAt = DateTime.MinValue;
        if (enabled)
        {
            var xml = BuildTaskXml(WindowsIdentity.GetCurrent().Name, ExecutablePath);
            try
            {
                WithRootFolder<object?>(folder => folder.RegisterTask(name, xml, TaskCreateOrUpdate, null, null, TaskLogonInteractiveToken, null));
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Couldn't create the sign-in task (0x{ex.HResult:X8}): {ex.Message}", ex);
            }
        }
        else
        {
            try
            {
                WithRootFolder<object?>(folder =>
                {
                    folder.DeleteTask(name, 0);
                    return null;
                });
            }
            catch (Exception ex) when (ex is FileNotFoundException or COMException)
            {
                // Already gone.
            }
        }
    }

    private (string? Command, bool Enabled)? ReadTask()
    {
        try
        {
            return WithRootFolder<(string?, bool)?>(folder =>
            {
                var task = folder.GetTask(name);
                var doc = XDocument.Parse((string)task.Xml);
                var command = doc.Descendants(TaskNs + "Command").FirstOrDefault()?.Value;
                return (command, (bool)task.Enabled);
            });
        }
        catch (Exception)
        {
            return null; // not registered, or Task Scheduler unavailable: treat as off
        }
    }

    private static T WithRootFolder<T>(Func<dynamic, T> action)
    {
        var type = Type.GetTypeFromProgID("Schedule.Service") ?? throw new InvalidOperationException("Task Scheduler isn't available.");
        dynamic service = Activator.CreateInstance(type)!;
        try
        {
            service.Connect();
            dynamic folder = service.GetFolder(@"\");
            try
            {
                return action(folder);
            }
            finally
            {
                Marshal.FinalReleaseComObject(folder);
            }
        }
        finally
        {
            Marshal.FinalReleaseComObject(service);
        }
    }

    internal static string BuildTaskXml(string user, string exe)
    {
        var u = SecurityElement.Escape(user);
        var x = SecurityElement.Escape(exe);
        return $"""
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <RegistrationInfo>
                <Author>Shelf</Author>
                <Description>Starts Shelf in the notification area when you sign in, so game time is counted. Turn it off in Shelf: Settings, Start with Windows.</Description>
              </RegistrationInfo>
              <Triggers>
                <LogonTrigger><Enabled>true</Enabled><UserId>{u}</UserId></LogonTrigger>
              </Triggers>
              <Principals>
                <Principal id="Author"><UserId>{u}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
              </Principals>
              <Settings>
                <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
                <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
                <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
                <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
                <Priority>7</Priority>
                <Enabled>true</Enabled>
              </Settings>
              <Actions Context="Author">
                <Exec><Command>{x}</Command><Arguments>{MinimizedArg}</Arguments></Exec>
              </Actions>
            </Task>
            """;
    }
}
