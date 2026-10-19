using System.Drawing;
using System.Windows.Forms;

namespace Shelf.App.Tray;

/// <summary>Notification-area icon: open, what's playing, refresh, quit. Balloon tips double as Windows toasts.</summary>
internal sealed class TrayController : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ContextMenuStrip _menu;
    private readonly Action _open;
    private readonly Action _refresh;
    private readonly Action _exit;
    private Action? _balloonAction;
    private string _playing = "";

    public TrayController(Icon icon, Action open, Action refresh, Action exit)
    {
        _open = open;
        _refresh = refresh;
        _exit = exit;
        _menu = new ContextMenuStrip { Font = new Font("Segoe UI", 9.5f), ShowImageMargin = false, Padding = new Padding(2) };
        _menu.Opening += (_, _) => Rebuild();
        _icon = new NotifyIcon { Icon = icon, Text = "Shelf", ContextMenuStrip = _menu, Visible = true };
        _icon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) _open();
        };
        _icon.BalloonTipClicked += (_, _) => (_balloonAction ?? _open)();
        _icon.BalloonTipClosed += (_, _) => _balloonAction = null;
    }

    /// <summary>Tooltip: what's being played right now.</summary>
    public void SetPlaying(IReadOnlyList<string> titles)
    {
        _playing = titles.Count == 0 ? "" : string.Join(", ", titles);
        var text = titles.Count == 0 ? "Shelf · tracking playtime" : $"Shelf · playing {_playing}";
        _icon.Text = text.Length > 127 ? text[..127] : text;
    }

    /// <summary>A Windows notification; clicking it runs <paramref name="onClick"/> (or opens Shelf).</summary>
    public void Notify(string title, string text, Action? onClick = null)
    {
        _balloonAction = onClick;
        _icon.ShowBalloonTip(6000, title, text, ToolTipIcon.None);
    }

    private void Rebuild()
    {
        _menu.Items.Clear();
        _menu.Items.Add(new ToolStripMenuItem("Open Shelf", null, (_, _) => _open()) { Font = new Font("Segoe UI Semibold", 9.5f) });
        if (_playing.Length > 0) _menu.Items.Add(new ToolStripMenuItem($"Playing: {_playing}") { Enabled = false });
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Refresh library", null, (_, _) => _refresh()));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Quit Shelf (stops tracking)", null, (_, _) => _exit()));
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        _menu.Dispose();
    }
}
