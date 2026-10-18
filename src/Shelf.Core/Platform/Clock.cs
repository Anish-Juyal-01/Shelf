namespace Shelf.Core.Platform;

public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public static readonly SystemClock Instance = new();

    public DateTime UtcNow => DateTime.UtcNow;
}

/// <summary>Unix milliseconds, the storage format for every timestamp in the database.</summary>
public static class UnixMs
{
    public static long From(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    public static long From(DateTimeOffset value) => value.ToUnixTimeMilliseconds();

    public static DateTime ToUtc(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
}
