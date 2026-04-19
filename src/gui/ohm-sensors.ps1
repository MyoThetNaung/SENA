# Requires Open Hardware Monitor (or compatible fork) running — exposes WMI at root\OpenHardwareMonitor
$ErrorActionPreference = 'Stop'
try {
  $rows = @()
  Get-CimInstance -Namespace root/OpenHardwareMonitor -Class Sensor -ErrorAction Stop | ForEach-Object {
    if ($null -ne $_.Value) {
      $rows += [PSCustomObject]@{
        Identifier = $_.Identifier
        Name       = $_.Name
        Value      = [double]$_.Value
      }
    }
  }
  @{ ok = $true; sensors = $rows } | ConvertTo-Json -Compress -Depth 10
}
catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
