using System.IO;

namespace Shelf.App.Shell;

/// <summary>Ensures one Shelf per user session; a second launch asks the first to show its window.</summary>
internal sealed class SingleInstance : IDisposable
{
    // A copy pointed at its own data folder (SHELF_DATA_DIR) is a separate instance, so it can run next to the real one.
    private static readonly string Suffix = Environment.GetEnvironmentVariable("SHELF_DATA_DIR") is { Length: > 0 } dir
        ? "." + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Path.GetFullPath(dir).ToLowerInvariant())))[..12]
        : "";
    private static readonly string MutexName = @"Local\Shelf.SingleInstance.v1" + Suffix;
    private static readonly string EventName = @"Local\Shelf.Activate.v1" + Suffix;

    private readonly Mutex _mutex;
    private readonly EventWaitHandle _activate;
    private readonly RegisteredWaitHandle? _wait;

    private SingleInstance(Mutex mutex, EventWaitHandle activate, Action onActivate)
    {
        _mutex = mutex;
        _activate = activate;
        _wait = ThreadPool.RegisterWaitForSingleObject(activate, (_, _) => onActivate(), null, Timeout.Infinite, executeOnlyOnce: false);
    }

    /// <summary>Returns null if Shelf is already running (after asking it to show its window, unless told not to).</summary>
    public static SingleInstance? TryAcquire(Action onActivate, bool activateExisting = true)
    {
        var mutex = new Mutex(initiallyOwned: true, MutexName, out bool created);
        var activate = new EventWaitHandle(false, EventResetMode.AutoReset, EventName);
        if (!created)
        {
            if (activateExisting) activate.Set();
            activate.Dispose();
            mutex.Dispose();
            return null;
        }

        return new SingleInstance(mutex, activate, onActivate);
    }

    public void Dispose()
    {
        _wait?.Unregister(null);
        _activate.Dispose();
        try { _mutex.ReleaseMutex(); } catch (ApplicationException) { }
        _mutex.Dispose();
    }
}
