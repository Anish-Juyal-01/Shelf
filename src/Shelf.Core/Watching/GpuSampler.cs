using System.Runtime.InteropServices;

namespace Shelf.Core.Watching;

public interface IGpuSampler : IDisposable
{
    /// <summary>3D-engine utilisation (0–100) of one process since the previous call for that pid; null when unknown.</summary>
    double? Sample(int pid);

    /// <summary>False when Windows doesn't expose GPU counters (old drivers, some VMs).</summary>
    bool Available { get; }
}

/// <summary>
/// Per-process GPU use from the "GPU Engine" performance counters (the same numbers Task Manager shows), via PDH.
/// Only one process is watched at a time — the foreground candidate — so the cost stays negligible.
/// </summary>
public sealed class PdhGpuSampler : IGpuSampler
{
    private IntPtr _query;
    private IntPtr _counter;
    private int _pid = -1;

    public bool Available { get; private set; } = true;

    public double? Sample(int pid)
    {
        if (!Available) return null;
        if (pid != _pid)
        {
            Close();
            if (PdhOpenQueryW(null, IntPtr.Zero, out _query) != 0) { Available = false; return null; }
            var path = $@"\GPU Engine(pid_{pid}_*engtype_3D)\Utilization Percentage";
            if (PdhAddEnglishCounterW(_query, path, IntPtr.Zero, out _counter) != 0) { Close(); Available = false; return null; }
            _pid = pid;
            PdhCollectQueryData(_query); // first sample: rates need two
            return null;
        }
        if (PdhCollectQueryData(_query) != 0) return null;
        return ReadSum();
    }

    private double? ReadSum()
    {
        uint size = 0, count = 0;
        var status = PdhGetFormattedCounterArrayW(_counter, PDH_FMT_DOUBLE, ref size, ref count, IntPtr.Zero);
        if (status != PDH_MORE_DATA || size == 0) return status == 0 ? 0 : null;
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (PdhGetFormattedCounterArrayW(_counter, PDH_FMT_DOUBLE, ref size, ref count, buffer) != 0) return null;
            // PDH_FMT_COUNTERVALUE_ITEM_W: name pointer, then { uint CStatus; (pad); double value }.
            var itemSize = IntPtr.Size + 16;
            double sum = 0;
            for (var i = 0; i < count; i++)
            {
                var item = buffer + i * itemSize;
                var cstatus = Marshal.ReadInt32(item, IntPtr.Size);
                if (cstatus is 0 or 1) sum += BitConverter.Int64BitsToDouble(Marshal.ReadInt64(item, IntPtr.Size + 8));
            }
            return Math.Min(100, sum);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private void Close()
    {
        if (_query != IntPtr.Zero) PdhCloseQuery(_query);
        _query = IntPtr.Zero;
        _counter = IntPtr.Zero;
        _pid = -1;
    }

    public void Dispose() => Close();

    private const uint PDH_FMT_DOUBLE = 0x00000200;
    private const uint PDH_MORE_DATA = 0x800007D2;

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhOpenQueryW(string? dataSource, IntPtr userData, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhAddEnglishCounterW(IntPtr query, string path, IntPtr userData, out IntPtr counter);
    [DllImport("pdh.dll")] private static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint bufferSize, ref uint itemCount, IntPtr items);
    [DllImport("pdh.dll")] private static extern uint PdhCloseQuery(IntPtr query);
}
