# Long-lived TCP-table snapshot helper — fast version.
#
# Calls iphlpapi.dll's GetExtendedTcpTable directly via P/Invoke (sub-1ms)
# instead of Get-NetTCPConnection (~1s via CIM/WMI). Process names come from
# [System.Diagnostics.Process]::GetProcesses() (one call, all PIDs, ~10ms).
#
# Reads commands from stdin (one per line):
#   snapshot       — emit the full Established-connection map, then '---END---'
#   lookup <port>  — emit one lookup-result JSON for the given local port
#   shutdown       — exit

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

Add-Type @"
using System;
using System.Net;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class TcpTable {
    [DllImport("iphlpapi.dll", SetLastError = true)]
    public static extern uint GetExtendedTcpTable(
        IntPtr pTcpTable,
        ref uint pdwSize,
        bool bOrder,
        uint ulAf,        // AF_INET = 2
        int  TableClass,  // TCP_TABLE_OWNER_PID_ALL = 5
        uint Reserved);

    [StructLayout(LayoutKind.Sequential)]
    public struct MIB_TCPROW_OWNER_PID {
        public uint state;
        public uint localAddr;
        public uint localPort;   // port in low 16 bits, network byte order
        public uint remoteAddr;
        public uint remotePort;
        public uint owningPid;
    }

    public const uint MIB_TCP_STATE_ESTAB = 5;

    /// Returns the list of ESTABLISHED IPv4 TCP rows, fast.
    public static List<MIB_TCPROW_OWNER_PID> GetEstablished() {
        uint size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, 2, 5, 0);   // probe for size
        IntPtr buf = Marshal.AllocHGlobal((int)size);
        try {
            uint rc = GetExtendedTcpTable(buf, ref size, false, 2, 5, 0);
            if (rc != 0) throw new Exception("GetExtendedTcpTable returned " + rc);
            uint numEntries = (uint)Marshal.ReadInt32(buf);
            int rowSize = Marshal.SizeOf(typeof(MIB_TCPROW_OWNER_PID));
            var rows = new List<MIB_TCPROW_OWNER_PID>((int)numEntries);
            IntPtr rowPtr = new IntPtr(buf.ToInt64() + 4);            // skip dwNumEntries header
            for (uint i = 0; i < numEntries; i++) {
                var row = (MIB_TCPROW_OWNER_PID)Marshal.PtrToStructure(rowPtr, typeof(MIB_TCPROW_OWNER_PID));
                if (row.state == MIB_TCP_STATE_ESTAB) rows.Add(row);
                rowPtr = new IntPtr(rowPtr.ToInt64() + rowSize);
            }
            return rows;
        } finally {
            Marshal.FreeHGlobal(buf);
        }
    }

    /// Convert the network-byte-order port from a MIB row's dwLocalPort/dwRemotePort
    /// into an integer host-order port.
    public static ushort PortFromMib(uint dwPort) {
        return (ushort)(((dwPort & 0xFF) << 8) | ((dwPort & 0xFF00) >> 8));
    }
}
"@

# Signal readiness
[Console]::Out.WriteLine('{"kind":"ready"}')
[Console]::Out.Flush()

function Get-ProcessNameCache {
    $c = @{}
    foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {
        try { $c[$p.Id] = $p.ProcessName } catch {}
    }
    return $c
}

function Emit-Snapshot {
    try {
        $rows = [TcpTable]::GetEstablished()
        $names = Get-ProcessNameCache
        foreach ($row in $rows) {
            $port = [int]([TcpTable]::PortFromMib($row.localPort))
            $rowPid = [int]$row.owningPid
            if ($names.ContainsKey($rowPid)) {
                $name = $names[$rowPid]
                if ($name) {
                    $line = '{"port":' + $port + ',"pid":' + $rowPid + ',"name":"' + ($name -replace '"','\"') + '"}'
                    [Console]::Out.WriteLine($line)
                }
            }
        }
    } catch {
        [Console]::Error.WriteLine("snapshot-error: $($_.Exception.Message)")
    }
    [Console]::Out.WriteLine('---END---')
    [Console]::Out.Flush()
}

function Emit-Lookup([int]$lookupPort) {
    try {
        $rows = [TcpTable]::GetEstablished()
        foreach ($row in $rows) {
            $port = [int]([TcpTable]::PortFromMib($row.localPort))
            if ($port -eq $lookupPort) {
                $foundPid = [int]$row.owningPid
                $p = Get-Process -Id $foundPid -ErrorAction SilentlyContinue
                if ($p) {
                    $name = $p.ProcessName -replace '"','\"'
                    [Console]::Out.WriteLine('{"kind":"lookup-result","port":' + $port + ',"pid":' + $foundPid + ',"name":"' + $name + '"}')
                    [Console]::Out.Flush()
                    return
                }
            }
        }
    } catch {
        [Console]::Error.WriteLine("lookup-error: $($_.Exception.Message)")
    }
    [Console]::Out.WriteLine('{"kind":"lookup-result","port":' + $lookupPort + ',"pid":null,"name":null}')
    [Console]::Out.Flush()
}

while ($true) {
    $line = $null
    try { $line = [Console]::In.ReadLine() } catch { break }
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq 'shutdown') { break }
    if ($line -match '^lookup\s+(\d+)$') {
        Emit-Lookup([int]$Matches[1])
        continue
    }
    if ($line -eq 'snapshot' -or $line -eq '') {
        Emit-Snapshot
    }
}
