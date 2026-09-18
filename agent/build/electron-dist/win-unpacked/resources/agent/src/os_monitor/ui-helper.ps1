# Persistent UI helper for CloudFuze AI Governance desktop agent.
# Spawned ONCE at agent startup. Reads NDJSON commands from stdin.
# WPF assemblies are pre-loaded so windows appear instantly (<100ms).
#
# Commands (one JSON per line on stdin):
#   {"cmd":"banner","name":"Claude","pid":1234}
#   {"cmd":"hide_banner"}
#   {"cmd":"access_request","app":"Claude","tool_host":"claude.ai",...}
#   {"cmd":"block_dialog","app":"Claude","patterns":"SSN",...}

try { [Console]::InputEncoding  = [System.Text.Encoding]::UTF8 } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Continue'

# ---- Pre-load ALL assemblies at startup ----
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

# ---- Pre-compile ALL Win32 helpers ----
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Diagnostics;

public static class UiHelper {
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int a);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    const int GWL_EXSTYLE = -20;
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_SHOWWINDOW = 0x0040;

    public static void EnableDpi() { try { SetProcessDpiAwareness(2); } catch {} }

    public static void MakeClickThrough(Window w) {
        var h = new WindowInteropHelper(w).Handle;
        int ex = GetWindowLong(h, GWL_EXSTYLE);
        SetWindowLong(h, GWL_EXSTYLE, ex | 0x00000020 | 0x00000080 | 0x08000000);
    }

    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    const int SW_HIDE = 0;
    const int SW_SHOW = 5;

    public static void HideBannerWin32() {
        if (_bannerHwnd != IntPtr.Zero) ShowWindow(_bannerHwnd, SW_HIDE);
    }

    static IntPtr _bannerHwnd, _targetHwnd;
    static uint _targetPid;

    public static void SetBannerHwnd(Window w) { _bannerHwnd = new WindowInteropHelper(w).Handle; }
    public static void SetTarget(uint pid) { _targetPid = pid; _targetHwnd = IntPtr.Zero; }

    public static int[] FindTargetRect() {
        if (_targetPid == 0) return null;
        _targetHwnd = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid == _targetPid && IsWindowVisible(h)) {
                RECT t; if (GetWindowRect(h, out t) && (t.Right - t.Left) > 100) { _targetHwnd = h; return false; }
            }
            return true;
        }, IntPtr.Zero);
        if (_targetHwnd == IntPtr.Zero) return null;
        RECT r;
        if (DwmGetWindowAttribute(_targetHwnd, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0)
            if (!GetWindowRect(_targetHwnd, out r)) return null;
        return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }

    public static void PositionBanner(int x, int y, int w, int h) {
        if (_bannerHwnd == IntPtr.Zero) return;
        var after = _targetHwnd != IntPtr.Zero ? _targetHwnd : (IntPtr)(-1);
        SetWindowPos(_bannerHwnd, after, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }

    public static bool IsTargetAlive() {
        try { Process.GetProcessById((int)_targetPid); return true; } catch { return false; }
    }

    public static bool IsTargetForeground() {
        var fg = GetForegroundWindow();
        uint pid; GetWindowThreadProcessId(fg, out pid);
        return pid == _targetPid;
    }
}
'@ -ReferencedAssemblies PresentationFramework, PresentationCore, WindowsBase, System.Xaml

[UiHelper]::EnableDpi()

# Write PID so the agent can kill us on restart
$ioDir = $args[0]
if ($ioDir) {
    [System.IO.File]::WriteAllText((Join-Path $ioDir 'ui-helper.pid'), [string]$PID)
}

# DPI scale
$physW = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
$logW  = [System.Windows.SystemParameters]::PrimaryScreenWidth
$dpi   = if ($logW -gt 0) { $physW / $logW } else { 1.0 }

# ---- State ----
$bannerWindow = $null
$bannerTimer = $null
$accessWindow = $null
$dialogWindow = $null

function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }

# ---- Banner ----
function Show-Banner($data) {
    if ($script:bannerWindow -and $script:bannerWindow.IsLoaded) {
        # Reuse — just update text and target
        $tb = $script:bannerWindow.Content.Child
        $tb.Text = [char]0x1F512 + " " + $data.name + " is blocked by CloudFuze AI Governance `u{2014} prompts cannot be sent here."
        [UiHelper]::SetTarget([uint32]$data.pid)
        if (-not $script:bannerWindow.IsVisible) { $script:bannerWindow.Show() }
        return
    }
    $n = Esc $data.name
    [xml]$x = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    WindowStyle="None" AllowsTransparency="True" ResizeMode="NoResize"
    Topmost="False" ShowInTaskbar="False" ShowActivated="False" Focusable="False"
    Background="Transparent" Left="0" Top="0" Width="400" Height="36" WindowStartupLocation="Manual">
    <Window.Effect><DropShadowEffect ShadowDepth="2" Direction="270" Opacity="0.45" BlurRadius="6" Color="#000000"/></Window.Effect>
    <Border Background="#b91c1c" CornerRadius="8,8,0,0">
        <TextBlock Text="&#x1F512; $n is blocked by CloudFuze AI Governance &#x2014; prompts cannot be sent here."
            Foreground="White" FontFamily="Segoe UI" FontSize="13" FontWeight="SemiBold"
            HorizontalAlignment="Center" VerticalAlignment="Center" Padding="10,0,10,0" TextTrimming="CharacterEllipsis"/>
    </Border>
</Window>
"@
    $r = New-Object System.Xml.XmlNodeReader $x
    $script:bannerWindow = [System.Windows.Markup.XamlReader]::Load($r)
    $script:bannerWindow.Add_SourceInitialized({
        [UiHelper]::MakeClickThrough($script:bannerWindow)
        [UiHelper]::SetBannerHwnd($script:bannerWindow)
    })
    [UiHelper]::SetTarget([uint32]$data.pid)

    # Timer for position tracking
    if ($script:bannerTimer) { $script:bannerTimer.Stop() }
    $script:bannerActive = $true
    $script:missCount = 0
    $script:bannerTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:bannerTimer.Interval = [TimeSpan]::FromMilliseconds(16)
    $script:bannerTimer.Add_Tick({
        if (-not $script:bannerActive) { return }
        try {
            $rect = [UiHelper]::FindTargetRect()
            if ($rect) {
                $script:missCount = 0
                $bh = [math]::Round(36 * $dpi)
                [UiHelper]::PositionBanner($rect[0], $rect[1] - $bh, $rect[2], $bh)
                if (-not $script:bannerWindow.IsVisible) { $script:bannerWindow.Show() }
            } else {
                $script:missCount++
                if ($script:missCount -gt 30) { Hide-Banner }
            }
        } catch {}
    })
    $script:bannerTimer.Start()
    $script:bannerWindow.Show()
}

function Hide-Banner {
    $script:bannerActive = $false
    if ($script:bannerTimer) { $script:bannerTimer.Stop() }
    # Use Win32 ShowWindow(SW_HIDE) — WPF's Hide() doesn't work after SetWindowPos
    [UiHelper]::HideBannerWin32()
    try { if ($script:bannerWindow) { $script:bannerWindow.Hide() } } catch {}
}

# ---- Access Request Dialog ----
# WS_EX_NOACTIVATE: window is clickable but NEVER steals focus from the blocked app.
# This keeps the enforcer armed. No textarea (can't type without focus — reason is optional).
function Show-AccessRequest($data) {
    if ($script:accessWindow -and $script:accessWindow.IsLoaded -and $script:accessWindow.IsVisible) { return }
    $n = Esc $data.app
    $ba = if ($data.blocked_agent) { Esc $data.blocked_agent } else { $n }
    [xml]$x = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    WindowStyle="None" AllowsTransparency="True" ResizeMode="NoResize"
    Topmost="True" ShowInTaskbar="False" ShowActivated="False" Focusable="False"
    Background="Transparent" Width="420" Height="280" WindowStartupLocation="CenterScreen">
    <Border Background="#1c1f2e" BorderBrush="#2a2d3e" BorderThickness="1" CornerRadius="8" Padding="24">
        <Border.Effect><DropShadowEffect BlurRadius="40" Opacity="0.5" ShadowDepth="10" Color="#000000"/></Border.Effect>
        <StackPanel>
            <TextBlock Text="&#x1F6AB; $n is blocked" Foreground="#e1e4ed" FontSize="16" FontWeight="Bold" FontFamily="Segoe UI" Margin="0,0,0,8"/>
            <TextBlock Text="Your organization has disallowed this AI app on this device. Nothing you type here can be sent." Foreground="#8b8fa3" FontSize="12.5" FontFamily="Segoe UI" TextWrapping="Wrap" Margin="0,0,0,12"/>
            <Border Background="#1Fef4444" CornerRadius="999" Padding="8,4" HorizontalAlignment="Left" Margin="0,0,0,20">
                <TextBlock Text="$ba" Foreground="#ef4444" FontSize="11.5" FontWeight="SemiBold" FontFamily="Segoe UI"/>
            </Border>
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="BtnCancel" Content="Not now" Background="Transparent" Foreground="#8b8fa3" BorderThickness="0" FontSize="12.5" FontWeight="SemiBold" FontFamily="Segoe UI" Padding="18,9" Cursor="Hand" Margin="0,0,8,0"/>
                <Button x:Name="BtnSubmit" Content="Request access" Background="#2563eb" Foreground="White" BorderThickness="0" FontSize="12.5" FontWeight="SemiBold" FontFamily="Segoe UI" Padding="18,9" Cursor="Hand">
                    <Button.Resources><Style TargetType="Border"><Setter Property="CornerRadius" Value="5"/></Style></Button.Resources>
                </Button>
            </StackPanel>
            <TextBlock Text="Your administrator decides, and any access they grant expires automatically." Foreground="#5c6070" FontSize="10.5" FontFamily="Segoe UI" Margin="0,12,0,0"/>
        </StackPanel>
    </Border>
</Window>
"@
    $r = New-Object System.Xml.XmlNodeReader $x
    $script:accessWindow = [System.Windows.Markup.XamlReader]::Load($r)
    # Make the window non-activatable — clickable but won't steal focus
    $script:accessWindow.Add_SourceInitialized({
        $hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($script:accessWindow)).Handle
        $ex = [UiHelper]::GetWindowLong($hwnd, -20)
        [UiHelper]::SetWindowLong($hwnd, -20, $ex -bor 0x08000000 -bor 0x00000080) # WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
    })
    $btnCancel = $script:accessWindow.FindName('BtnCancel')
    $btnSubmit = $script:accessWindow.FindName('BtnSubmit')

    $btnCancel.Add_Click({ $script:accessWindow.Hide() })
    $btnSubmit.Add_Click({
        Write-Response @{ cmd='access_request'; tool_host=$data.tool_host; tool_name=$data.tool_name; tool_vendor=($data.tool_vendor -replace '[^\w\s\.\-]',''); reason='' }
        $btnSubmit.Content = 'Sent!'
        $btnSubmit.IsEnabled = $false
        $ct = New-Object System.Windows.Threading.DispatcherTimer
        $ct.Interval = [TimeSpan]::FromSeconds(2)
        $ct.Add_Tick({ $ct.Stop(); $script:accessWindow.Hide(); $btnSubmit.Content='Request access'; $btnSubmit.IsEnabled=$true })
        $ct.Start()
    })
    $script:accessWindow.Show()
}

# ---- Block Dialog (DLP block with tokenize) ----
function Show-BlockDialog($data) {
    if ($script:dialogWindow -and $script:dialogWindow.IsLoaded -and $script:dialogWindow.IsVisible) { return }
    $n = Esc $data.app
    $p = Esc $data.patterns
    $prev = Esc $data.preview
    $showPreview = if ($data.rewritable -and $prev) { 'Visible' } else { 'Collapsed' }
    $showTokenize = if ($data.rewritable) { 'Visible' } else { 'Collapsed' }
    $showGotIt = if (-not $data.rewritable) { 'Visible' } else { 'Collapsed' }
    [xml]$x = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    WindowStyle="None" AllowsTransparency="True" ResizeMode="NoResize"
    Topmost="True" ShowInTaskbar="False" ShowActivated="False"
    Background="Transparent" Width="440" Height="400" WindowStartupLocation="CenterScreen">
    <Border Background="#1c1f2e" BorderBrush="#2a2d3e" BorderThickness="1" CornerRadius="8" Padding="24">
        <Border.Effect><DropShadowEffect BlurRadius="40" Opacity="0.5" ShadowDepth="10" Color="#000000"/></Border.Effect>
        <StackPanel HorizontalAlignment="Center">
            <TextBlock Text="&#x26A0;&#xFE0F; This prompt can't be sent" Foreground="#e1e4ed" FontSize="16" FontWeight="Bold" FontFamily="Segoe UI" HorizontalAlignment="Center" Margin="0,0,0,8"/>
            <TextBlock Foreground="#8b8fa3" FontSize="12.5" FontFamily="Segoe UI" TextWrapping="Wrap" HorizontalAlignment="Center" Margin="0,0,0,10">
                <Run Text="CloudFuze blocked sending to "/><Run Text="$n" FontWeight="SemiBold"/><Run Text=" because it contains sensitive data:"/>
            </TextBlock>
            <Border Background="#1Fef4444" CornerRadius="999" Padding="10,4" HorizontalAlignment="Center" Margin="0,0,0,14">
                <TextBlock Text="$p" Foreground="#ef4444" FontSize="11.5" FontWeight="SemiBold" FontFamily="Segoe UI"/>
            </Border>
            <Border Visibility="$showPreview" Background="#1F10b981" BorderBrush="#10b981" BorderThickness="1" CornerRadius="5" Padding="10" Margin="0,0,0,10">
                <StackPanel>
                    <TextBlock Text="THIS IS WHAT GETS SENT" Foreground="#10b981" FontSize="10.5" FontWeight="Bold" FontFamily="Segoe UI" Margin="0,0,0,6"/>
                    <TextBlock Text="$prev" Foreground="#e1e4ed" FontSize="12.5" FontFamily="Consolas" TextWrapping="Wrap"/>
                </StackPanel>
            </Border>
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,8,0,0">
                <Button x:Name="BtnTokenize" Content="Tokenize &amp; Send" Visibility="$showTokenize" Background="#10b981" Foreground="#0f1117" BorderThickness="0" FontSize="12.5" FontWeight="SemiBold" FontFamily="Segoe UI" Padding="18,9" Cursor="Hand" Margin="0,0,8,0">
                    <Button.Resources><Style TargetType="Border"><Setter Property="CornerRadius" Value="5"/></Style></Button.Resources>
                </Button>
                <Button x:Name="BtnDismiss" Content="Edit manually" Background="Transparent" Foreground="#8b8fa3" BorderThickness="0" FontSize="12.5" FontWeight="SemiBold" FontFamily="Segoe UI" Padding="18,9" Cursor="Hand"/>
                <Button x:Name="BtnGotIt" Content="Got it" Visibility="$showGotIt" Background="Transparent" Foreground="#8b8fa3" BorderThickness="0" FontSize="12.5" FontWeight="SemiBold" FontFamily="Segoe UI" Padding="18,9" Cursor="Hand"/>
            </StackPanel>
            <TextBlock Text="This event was reported to the security team." Foreground="#5c6070" FontSize="10.5" FontFamily="Segoe UI" HorizontalAlignment="Center" Margin="0,12,0,0"/>
        </StackPanel>
    </Border>
</Window>
"@
    $r = New-Object System.Xml.XmlNodeReader $x
    $script:dialogWindow = [System.Windows.Markup.XamlReader]::Load($r)
    $script:dialogWindow.FindName('BtnDismiss').Add_Click({ $script:dialogWindow.Hide() })
    $script:dialogWindow.FindName('BtnGotIt').Add_Click({ $script:dialogWindow.Hide() })
    $btnT = $script:dialogWindow.FindName('BtnTokenize')
    $btnT.Add_Click({
        Write-Response @{ cmd='tokenize'; block_id=$data.block_id }
        $btnT.Content = 'Masking...'
        $btnT.IsEnabled = $false
        $ct = New-Object System.Windows.Threading.DispatcherTimer
        $ct.Interval = [TimeSpan]::FromSeconds(8)
        $ct.Add_Tick({ $ct.Stop(); $script:dialogWindow.Hide(); $btnT.Content='Tokenize & Send'; $btnT.IsEnabled=$true })
        $ct.Start()
    })
    # Auto-close after 16 seconds
    $autoClose = New-Object System.Windows.Threading.DispatcherTimer
    $autoClose.Interval = [TimeSpan]::FromSeconds(16)
    $autoClose.Add_Tick({ $autoClose.Stop(); if ($script:dialogWindow.IsVisible) { $script:dialogWindow.Hide() } })
    $autoClose.Start()
    $script:dialogWindow.Show()
}

# ---- File-based IPC ----
# Agent writes commands to ui-cmd.jsonl, we read them.
# We write responses to ui-rsp.jsonl, agent reads them.
$ioDir = $args[0]
if (-not $ioDir) { $ioDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cloudfuze-aigov' }
$cmdFile = Join-Path $ioDir 'ui-cmd.jsonl'
$rspFile = Join-Path $ioDir 'ui-rsp.jsonl'
$lastCmdSize = 0

function Write-Response($obj) {
    try {
        $line = ($obj | ConvertTo-Json -Compress) + "`n"
        [System.IO.File]::AppendAllText($rspFile, $line)
    } catch {}
}

# ---- Command file poller (runs on UI thread every 100ms) ----
$cmdTimer = New-Object System.Windows.Threading.DispatcherTimer
$cmdTimer.Interval = [TimeSpan]::FromMilliseconds(100)
$cmdTimer.Add_Tick({
    try {
        if (-not (Test-Path $cmdFile)) { return }
        # Read file content — don't check size, just read and clear
        $content = $null
        try { $content = [System.IO.File]::ReadAllText($cmdFile) } catch { return }
        if ([string]::IsNullOrWhiteSpace($content)) { return }
        # Clear immediately after reading
        try { [System.IO.File]::WriteAllText($cmdFile, '') } catch {}
        foreach ($rawLine in $content.Split("`n")) {
            $rawLine = $rawLine.Trim()
            if ($rawLine.Length -eq 0) { continue }
            try {
                $msg = $rawLine | ConvertFrom-Json
                switch ($msg.cmd) {
                    'banner'          { Show-Banner $msg }
                    'hide_banner'     { Hide-Banner }
                    'access_request'  { Show-AccessRequest $msg }
                    'block_dialog'    { Show-BlockDialog $msg }
                }
            } catch {}
        }
    } catch {}
})
$cmdTimer.Start()

# ---- Run WPF dispatcher (Dispatcher.Run instead of $app.Run for reliable timer ticks) ----
[System.Windows.Threading.Dispatcher]::Run()
