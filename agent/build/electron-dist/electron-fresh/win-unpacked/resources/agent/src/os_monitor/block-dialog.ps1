# Dark popup showing what was blocked, with pattern chips and optionally
# a Tokenize & Send button.
#
# Spawned by the Node.js orchestrator. Reads one JSON line from stdin:
#   { "app": "ChatGPT", "patterns": "SSN, Credit Card", "block_id": "abc123",
#     "rewritable": true, "preview": "My SSN is [MASKED]", "filename": null }
#
# If rewritable: shows preview box + "Tokenize & Send" button + "Edit manually"
# If not rewritable: shows "Got it" button only
#
# "Tokenize & Send" writes {"cmd":"tokenize","block_id":"..."} to stdout
# Listens on stdin for {"result":"ok","block_id":"..."} to auto-close
# Auto-closes after 16 seconds
#
# Usage from Node.js:
#   spawn('powershell', ['-NoProfile','-NonInteractive','-Sta',
#     '-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',
#     'block-dialog.ps1'], { windowsHide: true, stdio: ['pipe','pipe','pipe'] })

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# ---- Read input: file argument or stdin ----
$inputFile = $args[0]
if ($inputFile -and (Test-Path $inputFile)) {
    $line = Get-Content -Raw $inputFile
    Remove-Item $inputFile -Force -ErrorAction SilentlyContinue
} else {
    $line = [Console]::In.ReadLine()
}
if ([string]::IsNullOrWhiteSpace($line)) { exit 1 }
$data = $line | ConvertFrom-Json

$appName    = if ($data.app)      { $data.app }      else { 'Unknown App' }
$patterns   = if ($data.patterns) { $data.patterns }  else { '' }
$blockId    = if ($data.block_id) { $data.block_id }  else { '' }
$rewritable = if ($null -ne $data.rewritable) { [bool]$data.rewritable } else { $false }
$preview    = if ($data.preview)  { $data.preview }   else { '' }
$filename   = if ($data.filename) { $data.filename }  else { $null }
$reason     = if ($data.reason)   { $data.reason }    else { '' }

# ---- Load WPF ----
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

# ---- Win32 interop for no-activate ----
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

public static class NoActivate {
    [DllImport("user32.dll")]
    static extern int GetWindowLong(IntPtr hwnd, int nIndex);

    [DllImport("user32.dll")]
    static extern int SetWindowLong(IntPtr hwnd, int nIndex, int dwNewLong);

    private const int GWL_EXSTYLE      = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;

    public static void Apply(Window w) {
        var hwnd = new WindowInteropHelper(w).Handle;
        int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
    }
}
'@ -ReferencedAssemblies PresentationFramework, PresentationCore, WindowsBase, System.Xaml

# ---- Build pattern chips XAML ----
function Build-PatternChips([string]$patternsStr) {
    $chips = ''
    if ([string]::IsNullOrWhiteSpace($patternsStr)) { return $chips }
    $patternList = $patternsStr -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
    foreach ($p in $patternList) {
        $escaped = [System.Security.SecurityElement]::Escape($p)
        $chips += @"
                        <Border Background="#1FEF4444" CornerRadius="10" Padding="8,3,8,3" Margin="0,0,6,4">
                            <TextBlock Text="$escaped" Foreground="#ef4444" FontSize="11.5" FontWeight="Bold" FontFamily="Segoe UI"/>
                        </Border>
"@
    }
    return $chips
}

$chipXaml = Build-PatternChips $patterns

# ---- Build body text ----
$escapedApp = [System.Security.SecurityElement]::Escape($appName)

if ($filename) {
    $escapedFile = [System.Security.SecurityElement]::Escape($filename)
    $bodyText = "The file &#x201C;$escapedFile&#x201D; contains sensitive data and was blocked from being attached to $escapedApp."
} elseif ($reason -eq 'paste') {
    $bodyText = "Your clipboard contains sensitive data that was blocked from being pasted into $escapedApp."
} else {
    $bodyText = "Your prompt to $escapedApp was blocked because it contains sensitive data matching your organization&#x2019;s DLP policy."
}

# ---- Build preview section (only if rewritable) ----
$previewSection = ''
if ($rewritable -and $preview) {
    $escapedPreview = [System.Security.SecurityElement]::Escape($preview)
    $previewSection = @"
                    <!-- Preview box -->
                    <Border Background="#1F10B981" BorderBrush="#10b981" BorderThickness="1" CornerRadius="5" Padding="12,10" Margin="0,12,0,0">
                        <StackPanel>
                            <TextBlock Text="THIS IS WHAT GETS SENT" Foreground="#10b981"
                                FontSize="10.5" FontWeight="Bold" FontFamily="Segoe UI"
                                Margin="0,0,0,6"/>
                            <TextBlock Text="$escapedPreview" Foreground="#e1e4ed"
                                FontSize="12.5" FontFamily="Consolas"
                                TextWrapping="Wrap" MaxHeight="120"/>
                        </StackPanel>
                    </Border>
"@
}

# ---- Build button section ----
$buttonSection = ''
if ($rewritable) {
    $buttonSection = @"
                    <!-- Buttons -->
                    <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                        <Button x:Name="BtnDismiss" Content="Edit manually"
                            Background="Transparent" Foreground="#8b8fa3" BorderThickness="0"
                            FontFamily="Segoe UI" FontSize="12.5" Padding="9,8"
                            Cursor="Hand" Margin="0,0,10,0"/>
                        <Button x:Name="BtnTokenize" Content="&#x2705; Tokenize &amp; Send"
                            Background="#10b981" Foreground="#0f1117" BorderThickness="0"
                            FontFamily="Segoe UI" FontSize="12.5" FontWeight="SemiBold"
                            Padding="18,9" Cursor="Hand">
                            <Button.Resources>
                                <Style TargetType="Border">
                                    <Setter Property="CornerRadius" Value="5"/>
                                </Style>
                            </Button.Resources>
                        </Button>
                    </StackPanel>
"@
} else {
    $buttonSection = @"
                    <!-- Button -->
                    <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                        <Button x:Name="BtnDismiss" Content="Got it"
                            Background="Transparent" Foreground="#8b8fa3" BorderThickness="0"
                            FontFamily="Segoe UI" FontSize="12.5" Padding="9,8"
                            Cursor="Hand"/>
                    </StackPanel>
"@
}

# ---- Full XAML ----
[xml]$xaml = @"
<Window
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    WindowStyle="None"
    AllowsTransparency="True"
    ResizeMode="NoResize"
    Topmost="True"
    ShowInTaskbar="False"
    ShowActivated="False"
    Focusable="False"
    Background="Transparent"
    SizeToContent="Height"
    Width="440"
    WindowStartupLocation="CenterScreen">
    <!-- Outer border with shadow -->
    <Border Background="#1c1f2e" CornerRadius="8" BorderBrush="#2a2d3e" BorderThickness="1"
            Margin="20">
        <Border.Effect>
            <DropShadowEffect ShadowDepth="10" Direction="270" Opacity="0.5" BlurRadius="60" Color="#000000"/>
        </Border.Effect>
        <Grid>
            <StackPanel Margin="24,20,24,20">
                <!-- Title -->
                <TextBlock FontSize="16" Foreground="#e1e4ed" FontWeight="Bold" FontFamily="Segoe UI"
                    Margin="0,0,0,10">
                    <Run Text="&#x26A0;&#xFE0F;"/> <Run Text="This prompt can't be sent"/>
                </TextBlock>

                <!-- Body text -->
                <TextBlock Text="$bodyText"
                    Foreground="#8b8fa3" FontSize="12.5" FontFamily="Segoe UI"
                    TextWrapping="Wrap" LineHeight="20"
                    Margin="0,0,0,12"/>

                <!-- Detected patterns label -->
                <TextBlock Text="DETECTED PATTERNS" Foreground="#5c6070"
                    FontSize="10.5" FontWeight="Bold" FontFamily="Segoe UI"
                    Margin="0,0,0,8"/>

                <!-- Pattern chips -->
                <WrapPanel Margin="0,0,0,4">
$chipXaml
                </WrapPanel>

$previewSection

$buttonSection

                <!-- Footnote -->
                <TextBlock Text="This event was reported to the security team."
                    Foreground="#5c6070" FontSize="10.5" FontFamily="Segoe UI"
                    Margin="0,14,0,0"/>
            </StackPanel>
        </Grid>
    </Border>
</Window>
"@

# ---- Create window ----
$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Apply no-activate
$window.Add_SourceInitialized({
    [NoActivate]::Apply($window)
})

# ---- Wire buttons ----
$btnDismiss = $window.FindName('BtnDismiss')
$btnTokenize = $window.FindName('BtnTokenize')

if ($btnDismiss) {
    $btnDismiss.Add_Click({
        $window.Close()
    })
}

if ($btnTokenize) {
    $btnTokenize.Add_Click({
        # Write tokenize command to stdout
        $cmd = @{ cmd = 'tokenize'; block_id = $blockId } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($cmd)
        [Console]::Out.Flush()
        # Update button text
        $btnTokenize.Content = 'Masking...'
        $btnTokenize.IsEnabled = $false
    })
}

# ---- Auto-close timer (16 seconds) ----
$autoCloseTimer = New-Object System.Windows.Threading.DispatcherTimer
$autoCloseTimer.Interval = [TimeSpan]::FromSeconds(16)
$autoCloseTimer.Add_Tick({
    $autoCloseTimer.Stop()
    $window.Close()
})

# No stdin reader — spawned via ShellExecute with no stdin pipe.

# Start auto-close timer when window is loaded
$window.Add_Loaded({
    $autoCloseTimer.Start()
})

# ---- Show the window ----
$window.Show()
[System.Windows.Threading.Dispatcher]::Run()
