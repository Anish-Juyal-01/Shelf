using System.Runtime.InteropServices;

namespace Shelf.Core.Watching;

public readonly record struct ForegroundWindow(int Pid, bool Fullscreen);

public interface IForegroundProbe
{
    ForegroundWindow? Current();
}

/// <summary>
/// The foreground window's process and whether it covers its whole monitor (exclusive fullscreen and borderless
/// windowed both do). Polled with the process snapshot, so it costs a few microseconds every few seconds.
/// </summary>
public sealed class Win32ForegroundProbe : IForegroundProbe
{
    public ForegroundWindow? Current()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero || hwnd == GetShellWindow() || hwnd == GetDesktopWindow()) return null;
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0) return null;
        return new ForegroundWindow((int)pid, IsFullscreen(hwnd));
    }

    private static bool IsFullscreen(IntPtr hwnd)
    {
        if (!GetWindowRect(hwnd, out var r)) return false;
        var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return false;
        var m = info.rcMonitor;
        return r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom;
    }

    private const uint MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);
}
