namespace Shelf.Core.Watching;

public sealed record OpenSessionInfo(long Id, long GameId, DateTime Start, DateTime LastHeartbeat);

/// <summary>Where the session tracker writes. Implemented over SQLite by <see cref="Storage.SessionStore"/>.</summary>
public interface ISessionStore
{
    long Open(long gameId, string? exePath, int pid, DateTime startUtc);

    void Heartbeat(IReadOnlyCollection<long> sessionIds, DateTime nowUtc);

    /// <summary>Ends a session and adds its duration to the game's totals. <paramref name="discard"/> deletes it instead (too short to count).</summary>
    void Close(long sessionId, DateTime endUtc, string reason, bool discard = false);

    IReadOnlyList<OpenSessionInfo> OpenSessions();
}
