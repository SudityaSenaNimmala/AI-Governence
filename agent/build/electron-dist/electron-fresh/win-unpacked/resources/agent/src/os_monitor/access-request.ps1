# Dark popup for requesting temporary access to a blocked AI platform.
#
# Spawned by the Node.js orchestrator. Reads one JSON line from stdin:
#   { "app": "ChatGPT", "tool_host": "chatgpt.com",
#     "tool_name": "ChatGPT", "blocked_agent": null }
#
# First checks for pending request by writing to stdout and reading response.
# If no pending request, shows form with textarea + "Request access" + "Not now".
# "Request access" writes the request to stdout and waits for confirmation.
# Auto-closes 3 seconds after success.
#
# This dialog IS focusable — the user types in the textarea.
#
# Usage from Node.js:
#   spawn('powershell', ['-NoProfile','-NonInteractive','-Sta',
#     '-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',
#     'access-request.ps1'], { windowsHide: true, stdio: ['pipe','pipe','pipe'] })

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# ---- Read input from file ----
$inputFile = $args[0]
if ($inputFile -and (Test-Path $inputFile)) {
    $line = Get-Content -Raw $inputFile
    Remove-Item $inputFile -Force -ErrorAction SilentlyContinue
} else {
    exit 1
}
if ([string]::IsNullOrWhiteSpace($line)) { exit 1 }
$data = $line | ConvertFrom-Json

$appName      = if ($data.app)           { $data.app }           else { 'Unknown App' }
$toolHost     = if ($data.tool_host)     { $data.tool_host }     else { '' }
$toolName     = if ($data.tool_name)     { $data.tool_name }     else { $appName }
$blockedAgent = if ($data.blocked_agent) { $data.blocked_agent } else { $null }

# ---- Load WPF ----
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

# ---- Build blocked-agent chip if present ----
$agentChipXaml = ''
if ($blockedAgent) {
    $escapedAgent = [System.Security.SecurityElement]::Escape($blockedAgent)
    $agentChipXaml = @"
                    <WrapPanel Margin="0,4,0,8">
                        <Border Background="#1FEF4444" CornerRadius="10" Padding="8,3,8,3" Margin="0,0,6,0">
                            <TextBlock Text="$escapedAgent" Foreground="#ef4444" FontSize="11.5"
                                FontWeight="Bold" FontFamily="Segoe UI"/>
                        </Border>
                    </WrapPanel>
"@
}

# ---- Escape app name for XAML ----
$escapedApp  = [System.Security.SecurityElement]::Escape($appName)
$escapedName = [System.Security.SecurityElement]::Escape($toolName)

# ---- XAML: Main request form ----
[xml]$xaml = @"
<Window
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    WindowStyle="None"
    AllowsTransparency="True"
    ResizeMode="NoResize"
    Topmost="True"
    ShowInTaskbar="False"
    ShowActivated="True"
    Background="Transparent"
    SizeToContent="Height"
    Width="460"
    WindowStartupLocation="CenterScreen">
    <Border x:Name="OuterBorder" Background="#1c1f2e" CornerRadius="8"
            BorderBrush="#2a2d3e" BorderThickness="1" Margin="20">
        <Border.Effect>
            <DropShadowEffect ShadowDepth="10" Direction="270" Opacity="0.5" BlurRadius="60" Color="#000000"/>
        </Border.Effect>
        <Grid>
            <!-- Main form panel -->
            <StackPanel x:Name="FormPanel" Margin="24,20,24,20">
                <!-- Title -->
                <TextBlock FontSize="16" Foreground="#e1e4ed" FontWeight="Bold" FontFamily="Segoe UI"
                    Margin="0,0,0,10">
                    <Run Text="&#x1F6AB;"/> <Run Text="$escapedName is blocked"/>
                </TextBlock>

                <!-- Body text -->
                <TextBlock
                    Text="Your organization has disallowed this AI app on this device. Nothing you type here can be sent."
                    Foreground="#8b8fa3" FontSize="12.5" FontFamily="Segoe UI"
                    TextWrapping="Wrap" LineHeight="20"
                    Margin="0,0,0,12"/>

$agentChipXaml

                <!-- Textarea label -->
                <TextBlock Text="WHY DO YOU NEED ACCESS? (OPTIONAL)" Foreground="#5c6070"
                    FontSize="10.5" FontWeight="Bold" FontFamily="Segoe UI"
                    Margin="0,4,0,6"/>

                <!-- Textarea -->
                <Border Background="#0f1117" BorderBrush="#2a2d3e" BorderThickness="1" CornerRadius="5">
                    <TextBox x:Name="TxtReason" AcceptsReturn="True" TextWrapping="Wrap"
                        MaxLength="500" Height="92"
                        Background="Transparent" Foreground="#e1e4ed"
                        CaretBrush="#e1e4ed" BorderThickness="0"
                        FontFamily="Segoe UI" FontSize="12.5"
                        Padding="10,8" VerticalScrollBarVisibility="Auto"/>
                </Border>

                <!-- Character counter -->
                <TextBlock x:Name="TxtCounter" Text="0 / 500" Foreground="#5c6070"
                    FontSize="10.5" FontFamily="Segoe UI"
                    HorizontalAlignment="Right" Margin="0,4,0,0"/>

                <!-- Buttons -->
                <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                    <Button x:Name="BtnNotNow" Content="Not now"
                        Background="Transparent" Foreground="#8b8fa3" BorderThickness="0"
                        FontFamily="Segoe UI" FontSize="12.5" Padding="9,8"
                        Cursor="Hand" Margin="0,0,10,0"/>
                    <Button x:Name="BtnRequest" Content="Request access"
                        Background="#2563eb" Foreground="White" BorderThickness="0"
                        FontFamily="Segoe UI" FontSize="12.5" FontWeight="SemiBold"
                        Padding="18,9" Cursor="Hand">
                        <Button.Resources>
                            <Style TargetType="Border">
                                <Setter Property="CornerRadius" Value="5"/>
                            </Style>
                        </Button.Resources>
                    </Button>
                </StackPanel>

                <!-- Footnote -->
                <TextBlock Text="Your administrator decides, and any access they grant expires automatically."
                    Foreground="#5c6070" FontSize="10.5" FontFamily="Segoe UI"
                    TextWrapping="Wrap" Margin="0,14,0,0"/>
            </StackPanel>

            <!-- Pending request panel (hidden by default) -->
            <StackPanel x:Name="PendingPanel" Margin="24,20,24,20" Visibility="Collapsed">
                <TextBlock FontSize="16" Foreground="#e1e4ed" FontWeight="Bold" FontFamily="Segoe UI"
                    Margin="0,0,0,10">
                    <Run Text="&#x1F6AB;"/> <Run Text="$escapedName is blocked"/>
                </TextBlock>

                <TextBlock x:Name="TxtPendingMsg" Foreground="#8b8fa3" FontSize="12.5"
                    FontFamily="Segoe UI" TextWrapping="Wrap" LineHeight="20"
                    Margin="0,0,0,16"/>

                <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,8,0,0">
                    <Button x:Name="BtnClosePending" Content="Close"
                        Background="Transparent" Foreground="#8b8fa3" BorderThickness="0"
                        FontFamily="Segoe UI" FontSize="12.5" Padding="9,8"
                        Cursor="Hand"/>
                </StackPanel>
            </StackPanel>

            <!-- Success panel (hidden by default) -->
            <StackPanel x:Name="SuccessPanel" Margin="24,20,24,20" Visibility="Collapsed">
                <TextBlock FontSize="16" Foreground="#e1e4ed" FontWeight="Bold" FontFamily="Segoe UI"
                    Margin="0,0,0,10">
                    <Run Text="&#x2705;"/> <Run Text="Request submitted"/>
                </TextBlock>

                <TextBlock x:Name="TxtSuccessMsg" Foreground="#8b8fa3" FontSize="12.5"
                    FontFamily="Segoe UI" TextWrapping="Wrap" LineHeight="20"
                    Margin="0,0,0,8"/>

                <TextBlock Text="Your administrator decides, and any access they grant expires automatically."
                    Foreground="#5c6070" FontSize="10.5" FontFamily="Segoe UI"
                    TextWrapping="Wrap" Margin="0,8,0,0"/>
            </StackPanel>
        </Grid>
    </Border>
</Window>
"@

# ---- Create window ----
$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# ---- Find named elements ----
$formPanel     = $window.FindName('FormPanel')
$pendingPanel  = $window.FindName('PendingPanel')
$successPanel  = $window.FindName('SuccessPanel')
$txtReason     = $window.FindName('TxtReason')
$txtCounter    = $window.FindName('TxtCounter')
$btnNotNow     = $window.FindName('BtnNotNow')
$btnRequest    = $window.FindName('BtnRequest')
$btnClosePend  = $window.FindName('BtnClosePending')
$txtPendingMsg = $window.FindName('TxtPendingMsg')
$txtSuccessMsg = $window.FindName('TxtSuccessMsg')

# ---- Focus border effect on textarea ----
$txtReasonBorder = $txtReason.Parent  # The Border wrapping the TextBox
$txtReason.Add_GotFocus({
    $txtReasonBorder.BorderBrush = [System.Windows.Media.BrushConverter]::new().ConvertFrom('#2563eb')
})
$txtReason.Add_LostFocus({
    $txtReasonBorder.BorderBrush = [System.Windows.Media.BrushConverter]::new().ConvertFrom('#2a2d3e')
})

# ---- Character counter ----
$txtReason.Add_TextChanged({
    $len = $txtReason.Text.Length
    $txtCounter.Text = "$len / 500"
})

# ---- Button: Not now ----
$btnNotNow.Add_Click({
    $window.Close()
})

# ---- Button: Close (pending) ----
$btnClosePend.Add_Click({
    $window.Close()
})

# ---- Shared state for stdin reader thread ----
$script:stdinResponseQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()

# No stdin reader — we're spawned via ShellExecute with no stdin pipe.
# IPC happens through the file-based command system in the agent.

# ---- Helper: read one JSON response from stdin (blocking on dispatcher) ----
# We poll from the dispatcher so we don't block the UI thread.
function Wait-StdinResponse {
    param([int]$TimeoutMs = 5000)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        $resp = $null
        if ($script:stdinResponseQueue.TryDequeue([ref]$resp)) {
            try { return ($resp | ConvertFrom-Json) } catch { continue }
        }
        # Pump WPF messages briefly to keep UI responsive
        [System.Windows.Threading.Dispatcher]::CurrentDispatcher.Invoke(
            [Action]{ },
            [System.Windows.Threading.DispatcherPriority]::Background
        )
        [System.Threading.Thread]::Sleep(50)
    }
    return $null
}

# ---- Button: Request access ----
$btnRequest.Add_Click({
    $reasonText = $txtReason.Text.Trim()

    # Determine vendor from host (simple heuristic)
    $vendor = 'Unknown'
    if ($toolHost -match 'openai|chatgpt')    { $vendor = 'OpenAI' }
    elseif ($toolHost -match 'anthropic|claude') { $vendor = 'Anthropic' }
    elseif ($toolHost -match 'google|gemini')   { $vendor = 'Google' }
    elseif ($toolHost -match 'microsoft|copilot') { $vendor = 'Microsoft' }

    # Write access request command to stdout
    $cmd = @{
        cmd         = 'access_request'
        tool_host   = $toolHost
        tool_name   = $toolName
        tool_vendor = $vendor
        reason      = $reasonText
    } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($cmd)
    [Console]::Out.Flush()

    # Disable button while waiting
    $btnRequest.Content = 'Submitting...'
    $btnRequest.IsEnabled = $false

    # Wait for response
    $resp = Wait-StdinResponse -TimeoutMs 8000

    if ($resp -and ($resp.submitted -eq $true -or $resp.queued -eq $true)) {
        # Show success
        $formPanel.Visibility = 'Collapsed'
        if ($resp.queued -eq $true) {
            $txtSuccessMsg.Text = "Your request has been queued and will be submitted when connectivity is restored."
        } else {
            $txtSuccessMsg.Text = "Your access request for $toolName has been submitted to your administrator."
        }
        $successPanel.Visibility = 'Visible'

        # Auto-close after 3 seconds
        $closeTimer = New-Object System.Windows.Threading.DispatcherTimer
        $closeTimer.Interval = [TimeSpan]::FromSeconds(3)
        $closeTimer.Add_Tick({
            $closeTimer.Stop()
            $window.Close()
        })
        $closeTimer.Start()
    } else {
        # Reset button on failure / timeout
        $btnRequest.Content = 'Request access'
        $btnRequest.IsEnabled = $true
    }
})

# ---- On window loaded: check pending status ----
$window.Add_Loaded({
    # Ask the parent if there's a pending request
    $checkCmd = @{ cmd = 'check_status'; tool_host = $toolHost } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($checkCmd)
    [Console]::Out.Flush()

    # Wait for response (up to 3 seconds)
    $resp = Wait-StdinResponse -TimeoutMs 3000

    if ($resp -and $resp.pending -eq $true) {
        # Show the pending panel
        $formPanel.Visibility = 'Collapsed'

        $timeAgo = ''
        if ($resp.requested_at) {
            try {
                $reqTime = [DateTime]::Parse($resp.requested_at)
                $diff = [DateTime]::UtcNow - $reqTime
                if ($diff.TotalMinutes -lt 60) {
                    $timeAgo = "$([math]::Floor($diff.TotalMinutes)) minutes ago"
                } elseif ($diff.TotalHours -lt 24) {
                    $timeAgo = "$([math]::Floor($diff.TotalHours)) hours ago"
                } else {
                    $timeAgo = "$([math]::Floor($diff.TotalDays)) days ago"
                }
            } catch {
                $timeAgo = 'recently'
            }
        } else {
            $timeAgo = 'recently'
        }
        $txtPendingMsg.Text = "You already asked for access to $toolName $timeAgo. Your administrator has been notified and will review your request."
        $pendingPanel.Visibility = 'Visible'
    }
    # else: show the form (default)
})

# ---- Show the window ----
$window.Show()
[System.Windows.Threading.Dispatcher]::Run()
