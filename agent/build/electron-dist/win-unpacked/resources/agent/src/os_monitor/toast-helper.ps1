# Toast helper — DISABLED.
# Toasts caused focus-steal which disarmed the enforcer's keystroke block.
# All user-facing feedback now goes through the Electron UI (banner, block
# dialog, access request popup). This script exits immediately.
[Console]::Out.WriteLine('{"kind":"ready","aumid":"disabled"}')
[Console]::Out.Flush()
# Keep stdin open so the parent doesn't see an unexpected exit, but do nothing.
while ($true) {
    $line = $null
    try { $line = [Console]::In.ReadLine() } catch { break }
    if ($null -eq $line) { break }
}
