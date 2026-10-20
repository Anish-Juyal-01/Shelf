using System.IO;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Shelf.App.Shell;

/// <summary>
/// Borderless window hosting the React UI in WebView2. The title bar, window buttons and resize edges are drawn by
/// the web UI and forwarded here (see <see cref="BeginDrag"/>), which keeps Aero Snap and native move/resize loops.
/// </summary>
internal sealed class MainWindow : Window
{
    private static readonly Color Night = Color.FromRgb(0x0D, 0x14, 0x11);
    private static readonly Color Day = Color.FromRgb(0xEC, 0xE4, 0xD3);
    private bool _light;

    private readonly WebView2 _web;
    private readonly UiAssets _assets = new();
    private readonly Func<string, string?> _art;
    private Task? _init;
    private readonly string _cacheDir;

    /// <param name="art">Maps "&lt;gameId&gt;/cover.jpg" to a file in Shelf's art cache (or null).</param>
    /// <param name="cacheDir">Shelf's cache folder; the window's browser data lives in it.</param>
    public MainWindow(Func<string, string?> art, string cacheDir)
    {
        _cacheDir = cacheDir;
        _art = art;
        Title = "Shelf";
        Width = 1280;
        Height = 820;
        MinWidth = 820;
        MinHeight = 560;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.CanResize;
        Background = new SolidColorBrush(Night);
        Icon = App.LoadIconImage();

        // Removes the default frame while keeping a DWM shadow; resize is handled via the web edges.
        WindowChrome.SetWindowChrome(this, new WindowChrome
        {
            CaptionHeight = 0,
            ResizeBorderThickness = new Thickness(0),
            GlassFrameThickness = new Thickness(0, 0, 0, 1),
            CornerRadius = new CornerRadius(0),
            UseAeroCaptionButtons = false,
        });

        _web = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(Night.R, Night.G, Night.B) };
        Content = _web;

        SourceInitialized += (_, _) =>
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            Native.ApplyFrame(hwnd, _light);
            HwndSource.FromHwnd(hwnd)?.AddHook(WndProc);
        };

        StateChanged += (_, _) => MaximizedChanged?.Invoke(WindowState == WindowState.Maximized);
    }

    /// <summary>A UI message, plus the real paths of any files sent with it (drag-and-drop).</summary>
    public event Action<string, IReadOnlyList<string>>? WebMessage;
    public event Action<bool>? MaximizedChanged;
    public event Action? SystemSuspending;
    public event Action? SystemResumed;

    /// <summary>Matches the native frame and the pre-paint background to the UI theme (no white/black flash).</summary>
    public void ApplyTheme(bool light)
    {
        _light = light;
        var c = light ? Day : Night;
        Background = new SolidColorBrush(c);
        _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(c.R, c.G, c.B);
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd != IntPtr.Zero) Native.ApplyFrame(hwnd, light);
    }

    /// <summary>Creates the WebView2 environment the first time the window is shown (saves memory when started in the tray).</summary>
    public Task EnsureWebAsync() => _init ??= InitializeWebAsync();

    public void Post(string json)
    {
        if (_web.CoreWebView2 is null) return;
        try
        {
            _web.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            // WebView is being torn down or suspended.
        }
    }

    public async Task SuspendAsync()
    {
        if (_web.CoreWebView2 is null) return;
        try
        {
            await _web.CoreWebView2.TrySuspendAsync();
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
        }
    }

    public void Resume()
    {
        try
        {
            if (_web.CoreWebView2?.IsSuspended == true) _web.CoreWebView2.Resume();
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
        }
    }

    public void BeginDrag(string? edge)
    {
        if (WindowState == WindowState.Maximized && edge is not null && edge != "caption") return;
        var hwnd = new WindowInteropHelper(this).Handle;
        Native.ReleaseCapture();
        Native.SendMessage(hwnd, Native.WM_NCLBUTTONDOWN, Native.HitTestFor(edge), IntPtr.Zero);
    }

    public void ToggleMaximize() =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    public void BringToFront()
    {
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        Topmost = true;  // reliably steal focus from the tray / another instance
        Topmost = false;
        Native.SetForegroundWindow(new WindowInteropHelper(this).Handle);
        _web.Focus();
    }

    private async Task InitializeWebAsync()
    {
        // Inside Shelf's own cache folder, so a copy with its own data folder (SHELF_DATA_DIR) gets its own browser too.
        var dataDir = Path.Combine(_cacheDir, "WebView2");
        CoreWebView2Environment env;
        try
        {
            env = await CoreWebView2Environment.CreateAsync(null, dataDir);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this,
                "Shelf needs the Microsoft Edge WebView2 Runtime, which ships with Windows 11.\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start Shelf again.",
                "Shelf", MessageBoxButton.OK, MessageBoxImage.Error);
            throw;
        }

        await _web.EnsureCoreWebView2Async(env);
        var core = _web.CoreWebView2;
        var s = core.Settings;
        s.AreDefaultContextMenusEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
#if DEBUG
        s.AreDevToolsEnabled = true;
        s.AreBrowserAcceleratorKeysEnabled = true;
#else
        s.AreDevToolsEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
#endif

        core.WebMessageReceived += (_, e) =>
        {
            var files = new List<string>();
            if (e.AdditionalObjects is { } objects)
                foreach (var o in objects)
                    if (o is CoreWebView2File f) files.Add(f.Path);
            WebMessage?.Invoke(e.WebMessageAsJson, files);
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;

        var devUrl = Environment.GetEnvironmentVariable("SHELF_DEV_URL");
        core.NavigationStarting += (_, e) =>
        {
            var allowed = e.Uri.StartsWith(UiAssets.Origin, StringComparison.OrdinalIgnoreCase)
                          || (devUrl is not null && e.Uri.StartsWith(devUrl, StringComparison.OrdinalIgnoreCase));
            if (!allowed) e.Cancel = true; // dropped files must never navigate the window away
        };

        if (!string.IsNullOrEmpty(devUrl))
        {
            core.Navigate(devUrl);
            return;
        }

        core.AddWebResourceRequestedFilter(UiAssets.Origin + "/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            var uri = new Uri(e.Request.Uri);
            if (uri.AbsolutePath.StartsWith("/art/", StringComparison.OrdinalIgnoreCase))
            {
                var file = _art(Uri.UnescapeDataString(uri.AbsolutePath["/art/".Length..]));
                e.Response = file is null
                    ? env.CreateWebResourceResponse(null, 404, "Not Found", "")
                    : env.CreateWebResourceResponse(new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite), 200, "OK",
                        $"Content-Type: {(file.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg")}\r\nCache-Control: max-age=86400");
                return;
            }
            var stream = _assets.Open(uri, out var type);
            e.Response = stream is null
                ? env.CreateWebResourceResponse(null, 404, "Not Found", "")
                : env.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {type}\r\nCache-Control: no-cache");
        };

        if (!_assets.HasUi)
        {
            core.NavigateToString("<body style='background:#0d1411;color:#ece4d2;font:14px Segoe UI;padding:40px'>" +
                                  "<h2>UI bundle missing</h2><p>Build the UI first: <code>cd ui &amp;&amp; npm run build</code>, then rebuild Shelf.</p></body>");
            return;
        }

        core.Navigate(UiAssets.Origin + "/index.html");
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        switch (msg)
        {
            case Native.WM_GETMINMAXINFO:
                var dpi = VisualTreeHelper.GetDpi(this);
                Native.ConstrainMaximizedToWorkArea(hwnd, lParam, (int)(MinWidth * dpi.DpiScaleX), (int)(MinHeight * dpi.DpiScaleY));
                handled = true;
                break;

            case Native.WM_POWERBROADCAST when wParam == PBT_APMSUSPEND:
                SystemSuspending?.Invoke();
                break;

            case Native.WM_POWERBROADCAST when wParam == Native.PBT_APMRESUMEAUTOMATIC:
                SystemResumed?.Invoke();
                break;
        }

        return IntPtr.Zero;
    }

    private const int PBT_APMSUSPEND = 0x0004;
}
