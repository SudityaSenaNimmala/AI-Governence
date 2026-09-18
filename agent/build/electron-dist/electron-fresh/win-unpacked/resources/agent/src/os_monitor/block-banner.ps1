# Red banner docked to the top of the blocked AI app's window.
# Follows the window if it moves/resizes. Disappears when killed by parent.
#
# Reads one JSON line from file arg or stdin: { "name": "Claude", "pid": 12345 }

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# ---- Read input ----
$inputFile = $args[0]
if ($inputFile -and (Test-Path $inputFile)) {
    $line = Get-Content -Raw $inputFile
    Remove-Item $inputFile -Force -ErrorAction SilentlyContinue
} else {
    $line = [Console]::In.ReadLine()
}
if ([string]::IsNullOrWhiteSpace($line)) { exit 1 }
$data = $line | ConvertFrom-Json
$appName = if ($data.name) { $data.name } else { 'Unknown App' }
$targetPid = if ($data.pid) { [int]$data.pid } else { 0 }

# ---- Load WPF + Win32 ----
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

public static class BannerHelper {
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int awareness);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int nIndex);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int cbSize);

    public static void EnableDpiAwareness() {
        try { SetProcessDpiAwareness(2); } catch {}
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    const int GWL_EXSTYLE = -20;
    const int WS_EX_TRANSPARENT = 0x00000020;
    const int WS_EX_TOOLWINDOW  = 0x00000080;
    const int WS_EX_NOACTIVATE  = 0x08000000;
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_SHOWWINDOW = 0x0040;

    static IntPtr _bannerHwnd;
    public static void SetBannerHwnd(Window w) {
        _bannerHwnd = new WindowInteropHelper(w).Handle;
    }

    // Move the banner using Win32 — places it just above the target window in z-order
    // so it shares the same layer (goes behind other apps when Claude does).
    public static void MoveBanner(int x, int y, int w, int h) {
        if (_bannerHwnd == IntPtr.Zero || _foundHwnd == IntPtr.Zero) return;
        // hWndInsertAfter = target window → banner sits just above it in z-order
        SetWindowPos(_bannerHwnd, _foundHwnd, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }

    // Check if a process is still alive
    public static bool IsProcessAlive(uint pid) {
        try { System.Diagnostics.Process.GetProcessById((int)pid); return true; }
        catch { return false; }
    }

    public static void MakeClickThrough(Window w) {
        var hwnd = new WindowInteropHelper(w).Handle;
        int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
    }

    // Callback for EnumWindows
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

    static IntPtr _foundHwnd;
    static uint _searchPid;

    // Find the main visible window for a given PID (regardless of focus)
    public static int[] GetTargetRect(uint targetPid) {
        if (targetPid == 0) return null;
        _foundHwnd = IntPtr.Zero;
        _searchPid = targetPid;
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == _searchPid && IsWindowVisible(hWnd)) {
                RECT test;
                if (GetWindowRect(hWnd, out test) && (test.Right - test.Left) > 100) {
                    _foundHwnd = hWnd;
                    return false; // stop enumerating
                }
            }
            return true;
        }, IntPtr.Zero);
        if (_foundHwnd == IntPtr.Zero) return null;
        RECT r;
        if (DwmGetWindowAttribute(_foundHwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) != 0) {
            if (!GetWindowRect(_foundHwnd, out r)) return null;
        }
        return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }
}
'@ -ReferencedAssemblies PresentationFramework, PresentationCore, WindowsBase, System.Xaml

# ---- Set DPI awareness BEFORE any screen/window calls ----
[BannerHelper]::EnableDpiAwareness()

# ---- Get DPI scale ----
Add-Type -AssemblyName System.Windows.Forms
$physW = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
$logW  = [System.Windows.SystemParameters]::PrimaryScreenWidth
$dpi   = if ($logW -gt 0) { $physW / $logW } else { 1.0 }

# ---- XAML ----
$escapedName = [System.Security.SecurityElement]::Escape($appName)

[xml]$xaml = @"
<Window
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    WindowStyle="None"
    AllowsTransparency="True"
    ResizeMode="NoResize"
    Topmost="False"
    ShowInTaskbar="False"
    ShowActivated="False"
    Focusable="False"
    Background="Transparent"
    Left="0" Top="0" Width="400" Height="36"
    WindowStartupLocation="Manual">
    <Window.Effect>
        <DropShadowEffect ShadowDepth="2" Direction="270" Opacity="0.45" BlurRadius="6" Color="#000000"/>
    </Window.Effect>
    <Border Background="#b91c1c" CornerRadius="8,8,0,0">
        <TextBlock
            Text="&#x1F512; $escapedName is blocked by CloudFuze AI Governance &#x2014; prompts cannot be sent here."
            Foreground="White"
            FontFamily="Segoe UI"
            FontSize="13"
            FontWeight="SemiBold"
            HorizontalAlignment="Center"
            VerticalAlignment="Center"
            Padding="10,0,10,0"
            TextTrimming="CharacterEllipsis"/>
    </Border>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [System.Windows.Markup.XamlReader]::Load($reader)

$window.Add_SourceInitialized({
    [BannerHelper]::MakeClickThrough($window)
    [BannerHelper]::SetBannerHwnd($window)
})

# ---- Position tracker ----
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(16)  # ~60fps smooth tracking
$missCount = 0
$timer.Add_Tick({
    try {
        $rect = [BannerHelper]::GetTargetRect([uint32]$targetPid)
        if ($rect) {
            $script:missCount = 0
            $bannerH = [math]::Round(36 * $dpi)
            # SetWindowPos places banner just above Claude in z-order —
            # when Claude goes behind other windows, banner follows naturally.
            # No show/hide needed — z-order does it all.
            [BannerHelper]::MoveBanner($rect[0], $rect[1] - $bannerH, $rect[2], $bannerH)
            if (-not $window.IsVisible) { $window.Show() }
        } else {
            $script:missCount++
            # Window gone for ~500ms — app was closed, exit banner
            if ($script:missCount -gt 30) {
                $timer.Stop()
                $window.Close()
                return
            }
        }
    } catch {}
})

# Initial position
$initRect = [BannerHelper]::GetTargetRect([uint32]$targetPid)
if ($initRect) {
    $bannerH = [math]::Round(36 * $dpi)
    [BannerHelper]::MoveBanner($initRect[0], $initRect[1] - $bannerH, $initRect[2], $bannerH)
}

$timer.Start()

[Console]::Out.WriteLine('{"kind":"ready"}')
[Console]::Out.Flush()

$window.Show()
[System.Windows.Threading.Dispatcher]::Run()
