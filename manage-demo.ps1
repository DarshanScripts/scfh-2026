param(
    [Parameter(Mandatory)]
    [ValidateSet('start', 'stop', 'restart')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
$demoScript = Join-Path $PSScriptRoot 'demo.mjs'
$demoArguments = '--env-file-if-exists=.env "{0}"' -f $demoScript
$demoPattern = '\s+--env-file-if-exists=\.env\s+"?' + [regex]::Escape($demoScript) + '"?\s*$'
$runtimeDir = Join-Path $PSScriptRoot '.hcu'
$stdout = Join-Path $runtimeDir 'demo.log'
$stderr = Join-Path $runtimeDir 'demo.error.log'

function Get-DemoProcess {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -match $demoPattern }
}

function Stop-Demo {
    $processes = @(Get-DemoProcess)
    if (!$processes.Count) {
        Write-Host 'The demo is already stopped.'
        return
    }
    foreach ($process in $processes) {
        & taskkill.exe /PID $process.ProcessId /T /F
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) {
            throw "Could not stop demo process $($process.ProcessId)."
        }
        Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
            throw "Demo process $($process.ProcessId) is still running."
        }
    }
    Write-Host 'The demo is stopped.'
}

function Start-Demo {
    if (Get-DemoProcess) {
        Write-Host 'The demo is already running. Use restart.cmd to reload it.'
        return
    }
    $node = (Get-Command node.exe).Source
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $launch = @{
        FilePath               = $node
        ArgumentList           = $demoArguments
        WorkingDirectory       = $PSScriptRoot
        WindowStyle            = 'Hidden'
        RedirectStandardOutput = $stdout
        RedirectStandardError  = $stderr
        PassThru               = $true
    }
    $process = Start-Process @launch

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $process.Refresh()
        if ($process.HasExited) {
            throw "The demo exited during startup. See $stderr and $stdout."
        }
        $menu = Get-NetTCPConnection -LocalAddress 127.0.0.1 -OwningProcess $process.Id -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($menu) {
            Write-Host 'The floating voice agent is starting.'
            return
        }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    Write-Host "The demo is still starting. See $stdout and $stderr for its status."
}

try {
    if ($Action -ne 'start') { Stop-Demo }
    if ($Action -ne 'stop') { Start-Demo }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
