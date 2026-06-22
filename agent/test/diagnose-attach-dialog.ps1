# Diagnostic: lists every top-level window over a 20s window so we can see
# what UIA element ChatGPT's "attach" button actually opens. Run this, then
# click the attach button in ChatGPT and pick (or cancel) a file.

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -Namespace Diag -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Auto, SetLastError=true)]
public static extern int GetWindowText(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Auto, SetLastError=true)]
public static extern int GetClassName(System.IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
'@

Write-Host "Listening for 25 seconds. CLICK THE ATTACH BUTTON IN CHATGPT NOW + pick a file (or cancel)..."
$seen = @{}
$end = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $end) {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($el in $all) {
        try {
            $hwnd = [int64]$el.Current.NativeWindowHandle
            if ($hwnd -eq 0) { continue }
            $key = "$hwnd|$($el.Current.ClassName)|$($el.Current.Name)"
            if ($seen.ContainsKey($key)) { continue }
            $seen[$key] = $true

            $procId = $el.Current.ProcessId
            $proc = $null
            try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch {}
            $pname = if ($proc) { $proc.ProcessName } else { '?' }

            "{0,-6}  pid={1,-6}  class='{2}'  title='{3}'  proc={4}" -f `
                $hwnd, $procId, $el.Current.ClassName, $el.Current.Name, $pname
        } catch {}
    }
    Start-Sleep -Milliseconds 500
}
"`nDone. Total unique top-level windows observed: $($seen.Count)"
