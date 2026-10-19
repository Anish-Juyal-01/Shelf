using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Shelf.App.Bridge;
using Shelf.App.Host;
using Shelf.App.Shell;
using Shelf.App.Tray;

namespace Shelf.App;

/// <summary>Composition root: single instance → host (database, watcher) → tray → window (created lazily).</summary>
public partial class App : Application
{
    public static string Version { get; } =
        typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";

    private SingleInstance? _instance;
    private AppHost? _host;
    private TrayController? _tray;
    private MainWindow? _window;
    private UiBridge? _bridge;
    private System.Drawing.Icon? _trayIcon;
    private string _themePref = "system";
    private bool? _lightApplied;
    private bool _exiting;
    private bool _toldAboutTray;

    public static ImageSource LoadIconImage()
    {
        using var stream = typeof(App).Assembly.GetManifestResourceStream("app.ico")!;
        var decoder = new IconBitmapDecoder(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
        return decoder.Frames.OrderByDescending(f => f.PixelWidth).First();
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += (_, ex) =>
        {
            WriteErrorLog(ex.Exception);
            ex.Handled = true;
        };
        AppDomain.CurrentDomain.UnhandledException += (_, ex) => WriteErrorLog(ex.ExceptionObject as Exception);

        // Started at sign-in: stay in the tray. A second copy started by hand brings the running window forward.
        var atLogin = e.Args.Contains(StartupManager.MinimizedArg, StringComparer.OrdinalIgnoreCase);
        _instance = SingleInstance.TryAcquire(() => Dispatcher.BeginInvoke(() => _ = ShowWindowAsync()), activateExisting: !atLogin);
        if (_instance is null)
        {
            Shutdown();
            return;
        }

        try
        {
            _host = new AppHost();
        }
        catch (Exception ex)
        {
            WriteErrorLog(ex);
            MessageBox.Show($"Shelf couldn't open its database.\n\n{ex.Message}", "Shelf", MessageBoxButton.OK, MessageBoxImage.Error);
            QuitApp();
            return;
        }
        _themePref = _host.Settings.Theme;

        using (var iconStream = typeof(App).Assembly.GetManifestResourceStream("app.ico")!)
            _trayIcon = new System.Drawing.Icon(iconStream, System.Windows.Forms.SystemInformation.SmallIconSize);
        _tray = new TrayController(_trayIcon, () => _ = ShowWindowAsync(), () => _host.RefreshAll(), QuitApp);

        _window = new MainWindow();
        _bridge = new UiBridge(_window, _host, QuitApp);
        _bridge.ThemeChanged += pref =>
        {
            _themePref = pref;
            ApplyTheme();
        };
        _window.Closing += OnWindowClosing;
        _window.SystemSuspending += () => _host.Watcher.Suspend();
        _window.SystemResumed += () => _host.Watcher.Resume();
        // The window may never be shown (started at sign-in), so power events also come from SystemEvents.
        Microsoft.Win32.SystemEvents.PowerModeChanged += (_, args) =>
        {
            if (args.Mode == Microsoft.Win32.PowerModes.Suspend) _host.Watcher.Suspend();
            else if (args.Mode == Microsoft.Win32.PowerModes.Resume) _host.Watcher.Resume();
        };
        Microsoft.Win32.SystemEvents.UserPreferenceChanged += (_, args) =>
        {
            if (args.Category == Microsoft.Win32.UserPreferenceCategory.General) Dispatcher.BeginInvoke(ApplyTheme);
        };

        _host.Notice += n => Dispatcher.BeginInvoke(() => OnNotice(n));
        _host.Changed += () => Dispatcher.BeginInvoke(UpdateTray);
        ApplyTheme();
        _host.Start();

        if (!atLogin) await ShowWindowAsync();
    }

    private void OnNotice(HostNotice n)
    {
        var windowInFront = _window is { IsVisible: true, IsActive: true } && _window.WindowState != WindowState.Minimized;
        if (n.Toast && !windowInFront)
        {
            _tray?.Notify(n.ToastTitle ?? "Shelf", n.Text, () =>
            {
                _ = ShowWindowAsync();
                if (n.View is not null) _bridge?.Navigate(n.View, n.GameId);
            });
        }
        _bridge?.ShowNotice(n);
    }

    private void UpdateTray()
    {
        if (_host is null || _tray is null) return;
        var titles = _host.Watcher.Playing.Keys.Select(id => _host.Library.GameTitle(id) ?? "a game").ToList();
        _tray.SetPlaying(titles);
    }

    private async Task ShowWindowAsync()
    {
        if (_window is null || _bridge is null || _exiting) return;
        _window.BringToFront();
        try
        {
            await _window.EnsureWebAsync();
        }
        catch (Exception ex)
        {
            WriteErrorLog(ex);
            return;
        }
        _window.Resume();
        _bridge.Active = true;
        await _bridge.SendFullStateAsync();
    }

    private async void HideToTray()
    {
        if (_window is null || _bridge is null) return;
        _bridge.Active = false;
        _window.Hide();
        await _window.SuspendAsync(); // frees CPU and memory while only the tray is visible
        if (!_toldAboutTray)
        {
            _toldAboutTray = true;
            _tray?.Notify("Shelf is still running", "It keeps counting your play time from the notification area.");
        }
    }

    private void OnWindowClosing(object? sender, CancelEventArgs e)
    {
        if (_exiting) return;
        e.Cancel = true;
        if (_host?.Settings.CloseToTray ?? true) HideToTray();
        else QuitApp();
    }

    /// <summary>Resolves "system" from Windows' app theme and themes the native frame.</summary>
    private void ApplyTheme()
    {
        var light = _themePref switch
        {
            "light" => true,
            "dark" => false,
            _ => WindowsUsesLightTheme(),
        };
        if (_lightApplied == light) return;
        _lightApplied = light;
        _window?.ApplyTheme(light);
    }

    private static bool WindowsUsesLightTheme()
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int v && v == 1;
    }

    private void QuitApp()
    {
        if (_exiting) return;
        _exiting = true;
        try
        {
            _host?.Dispose(); // closes open sessions cleanly
        }
        catch (Exception ex)
        {
            WriteErrorLog(ex);
        }
        _tray?.Dispose();
        _trayIcon?.Dispose();
        _window?.Close();
        _instance?.Dispose();
        Shutdown();
    }

    internal static void WriteErrorLog(Exception? ex)
    {
        if (ex is null) return;
        try
        {
            var dir = Core.Storage.ShelfPaths.Default().DataDir;
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "error.log"), $"[{DateTime.Now:O}] {ex}{Environment.NewLine}");
        }
        catch (IOException)
        {
        }
    }
}
