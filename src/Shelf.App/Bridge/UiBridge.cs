using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Shelf.App.Host;
using Shelf.App.Shell;

namespace Shelf.App.Bridge;

/// <summary>
/// JSON message protocol between the React UI and <see cref="AppHost"/>. Messages are <c>{ "type": "...", ... }</c>;
/// see ui/src/bridge/protocol.ts for the TypeScript side of the contract. State is rebuilt off the UI thread and
/// coalesced, so a burst of changes produces one update.
/// </summary>
internal sealed class UiBridge
{
    private readonly MainWindow _window;
    private readonly AppHost _host;
    private readonly Dispatcher _dispatcher;
    private readonly Action _requestExit;
    private bool _uiReady;
    private int _statePending;
    private long? _openGame;

    public UiBridge(MainWindow window, AppHost host, Action requestExit)
    {
        _window = window;
        _host = host;
        _requestExit = requestExit;
        _dispatcher = window.Dispatcher;

        window.WebMessage += OnMessage;
        window.MaximizedChanged += max => Send(new { type = "window", maximized = max });
        host.Changed += QueueState;
        host.ScanProgress += s => OnUi(() => Send(new { type = "scan", scan = s }));
        host.GameChanged += id =>
        {
            if (_openGame == id) _ = SendGameAsync(id);
        };
    }

    /// <summary>True while the window is visible; nothing is pushed to a hidden/suspended WebView.</summary>
    public bool Active { get; set; }

    /// <summary>Theme the UI asked for, so the native frame can match.</summary>
    public event Action<string>? ThemeChanged;

    public async Task SendFullStateAsync()
    {
        if (!_uiReady) return;
        var state = await Task.Run(_host.BuildState);
        ThemeChanged?.Invoke(state.Settings.Theme);
        Send(new { type = "hello", version = App.Version, maximized = _window.WindowState == WindowState.Maximized, state });
    }

    public void ShowNotice(HostNotice n) =>
        OnUi(() => Send(new { type = "notice", tone = n.Tone, text = n.Text, view = n.View, gameId = n.GameId }));

    public void Navigate(string view, long? gameId = null) => OnUi(() => Send(new { type = "navigate", view, gameId }));

    private void QueueState()
    {
        if (Interlocked.Exchange(ref _statePending, 1) == 1) return;
        Task.Run(async () =>
        {
            await Task.Delay(250); // coalesce bursts (a refresh changes many things at once)
            Interlocked.Exchange(ref _statePending, 0);
            if (!_uiReady || !Active) return;
            var state = _host.BuildState();
            OnUi(() =>
            {
                ThemeChanged?.Invoke(state.Settings.Theme);
                Send(new { type = "state", state });
            });
        });
    }

    private async Task SendGameAsync(long id)
    {
        var detail = await Task.Run(() => _host.GameDetail(id));
        if (detail is not null) OnUi(() => Send(new { type = "game", detail }));
    }

    private void OnUi(Action action) => _dispatcher.BeginInvoke(action);

    private void Send(object message)
    {
        if (!_uiReady || !Active) return;
        _window.Post(JsonSerializer.Serialize(message, Json.Options));
    }

    private static string Str(JsonElement m, string name) => m.GetProperty(name).GetString()!;

    private static bool? OptBool(JsonElement m, string name) =>
        m.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : null;

    private async void OnMessage(string json, IReadOnlyList<string> files)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var m = doc.RootElement;
            switch (m.GetProperty("type").GetString())
            {
                case "ready":
                    _uiReady = true;
                    await SendFullStateAsync();
                    break;

                case "getGame":
                    _openGame = m.GetProperty("id").GetInt64();
                    await SendGameAsync(_openGame.Value);
                    break;

                case "launch":
                    var launchId = m.GetProperty("gameId").GetInt64();
                    await Task.Run(() => _host.Launch(launchId));
                    break;

                case "openFolder":
                    _host.OpenFolder(Str(m, "path"));
                    break;

                case "reveal":
                    _host.Reveal(Str(m, "path"));
                    break;

                case "uninstall":
                    _host.Uninstall(m.GetProperty("installId").GetInt64());
                    break;

                case "setHidden":
                    _host.SetHidden(m.GetProperty("gameId").GetInt64(), m.GetProperty("hidden").GetBoolean());
                    break;

                case "rename":
                    _host.Rename(m.GetProperty("gameId").GetInt64(), Str(m, "title"));
                    break;

                case "accept":
                    var acceptId = m.GetProperty("id").GetInt64();
                    var title = m.TryGetProperty("title", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
                    await Task.Run(() => _host.Accept(acceptId, title));
                    break;

                case "reject":
                    _host.Reject(m.GetProperty("id").GetInt64());
                    break;

                case "addExe":
                    var pick = new Microsoft.Win32.OpenFileDialog
                    {
                        Title = "Pick the game's .exe",
                        Filter = "Programs (*.exe)|*.exe",
                        CheckFileExists = true,
                    };
                    if (pick.ShowDialog(_window) == true)
                    {
                        var exe = pick.FileName;
                        await Task.Run(() => _host.AddPaths([exe]));
                    }
                    break;

                case "dropFiles":
                    if (files.Count > 0) await Task.Run(() => _host.AddPaths(files));
                    break;

                case "refresh":
                    _host.RefreshAll();
                    break;

                case "cancelScan":
                    _host.CancelScan();
                    break;

                case "addRoot":
                    var folder = new Microsoft.Win32.OpenFolderDialog { Title = "Pick a folder where you keep games" };
                    if (folder.ShowDialog(_window) == true) _host.AddRoot(folder.FolderName);
                    break;

                case "addRootPath":
                    _host.AddRoot(Str(m, "path"));
                    break;

                case "removeRoot":
                    _host.RemoveRoot(Str(m, "path"));
                    break;

                case "scanDrive":
                    _host.ScanOnce(Str(m, "root"));
                    break;

                case "updateSettings":
                    var p = m.GetProperty("patch");
                    var theme = p.TryGetProperty("theme", out var th) ? th.GetString() : null;
                    var hero = p.TryGetProperty("heroStyle", out var hs) ? hs.GetString() : null;
                    var palette = p.TryGetProperty("palette", out var pl) ? pl.GetString() : null;
                    var (rd, wf, sw, ct) = (OptBool(p, "runtimeDetection"), OptBool(p, "watchFolders"), OptBool(p, "startWithWindows"), OptBool(p, "closeToTray"));
                    var webArt = OptBool(p, "webArt");
                    var gridKey = p.TryGetProperty("steamGridDbKey", out var gk) ? gk.GetString() : null;
                    await Task.Run(() => _host.UpdateSettings(theme, palette, hero, rd, wf, sw, ct, webArt, gridKey));
                    break;

                case "openDataFolder":
                    _host.OpenDataFolder();
                    break;

                case "window":
                    HandleWindow(m.GetProperty("action").GetString(), m.TryGetProperty("edge", out var edge) ? edge.GetString() : null);
                    break;
            }
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            Debug.WriteLine($"Bad UI message: {ex.Message} :: {json}");
        }
        catch (Exception ex)
        {
            ShowNotice(new HostNotice("error", $"Something went wrong: {ex.Message}"));
            App.WriteErrorLog(ex);
        }
    }

    private void HandleWindow(string? action, string? edge)
    {
        switch (action)
        {
            case "drag":
                _window.BeginDrag(edge ?? "caption");
                break;
            case "minimize":
                _window.WindowState = WindowState.Minimized;
                break;
            case "maximize":
                _window.ToggleMaximize();
                break;
            case "close":
                _window.Close(); // App decides between hide-to-tray and exit
                break;
            case "quit":
                _requestExit();
                break;
        }
    }
}
