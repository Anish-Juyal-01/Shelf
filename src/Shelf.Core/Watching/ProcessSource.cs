using System.Runtime.InteropServices;
using System.Text;

namespace Shelf.Core.Watching;

public readonly record struct ProcInfo(int Pid, string Name, string? Path);

public interface IProcessSource
{
    IReadOnlyList<ProcInfo> Snapshot();
}

/// <summary>
/// Running processes via a Toolhelp snapshot (names and pids in one call, no admin rights). The full exe path is
/// looked up once per new process with <c>PROCESS_QUERY_LIMITED_INFORMATION</c>, the least privileged access there is:
/// Shelf never reads a game's memory, injects or hooks anything, so anti-cheat has nothing to object to.
/// </summary>
public sealed class Win32ProcessSource : IProcessSource
{
    private readonly Dictionary<int, (string Name, string? Path)> _paths = [];

    public IReadOnlyList<ProcInfo> Snapshot()
    {
        var list = new List<ProcInfo>(400);
        var snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return list;
        try
        {
            var entry = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>() };
            if (!Process32FirstW(snap, ref entry)) return list;
            var seen = new HashSet<int>();
            do
            {
                var pid = (int)entry.th32ProcessID;
                if (pid <= 4) continue; // Idle, System
                seen.Add(pid);
                var name = entry.szExeFile;
                // A cached path is valid while the pid still has the same exe name (pid reuse with the same name is rare and harmless).
                if (!_paths.TryGetValue(pid, out var cached) || cached.Name != name)
                {
                    cached = (name, QueryPath(pid));
                    _paths[pid] = cached;
                }
                list.Add(new ProcInfo(pid, name, cached.Path));
            } while (Process32NextW(snap, ref entry));

            if (_paths.Count > seen.Count)
                foreach (var gone in _paths.Keys.Where(k => !seen.Contains(k)).ToList()) _paths.Remove(gone);
        }
        finally
        {
            CloseHandle(snap);
        }
        return list;
    }

    internal static string? QueryPath(int pid)
    {
        var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
        if (h == IntPtr.Zero) return null;
        try
        {
            var sb = new StringBuilder(1024);
            var size = (uint)sb.Capacity;
            return QueryFullProcessImageNameW(h, 0, sb, ref size) ? sb.ToString(0, (int)size) : null;
        }
        finally
        {
            CloseHandle(h);
        }
    }

    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageNameW(IntPtr hProcess, uint flags, StringBuilder exeName, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr h);
}
