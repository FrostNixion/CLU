# CLU media bridge: watches Windows' global media session (Spotify, browsers, players...)
# and prints one JSON line per change. Reads commands (toggle|next|prev|play|pause) on stdin.
# Requires Windows PowerShell 5.1 (WinRT projection).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(4000)
    if ($task.IsCompleted) { $task.Result } else { $null }
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Thumb($props) {
    try {
        if (-not $props.Thumbnail) { return $null }
        $ras = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        if (-not $ras) { return $null }
        $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
        $ms = New-Object System.IO.MemoryStream
        $stream.CopyTo($ms)
        $stream.Dispose()
        if ($ms.Length -gt 600KB) { return $null }
        return 'data:' + $ras.ContentType + ';base64,' + [Convert]::ToBase64String($ms.ToArray())
    } catch { return $null }
}

# Console.In.ReadLineAsync is synchronous on .NET Framework; a StreamReader over the raw
# stdin stream reads on the thread pool, so the polling loop keeps running.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$pending = $stdin.ReadLineAsync()
$lastKey = ''
$lastLine = ''

while ($true) {
    $s = $null
    try { $s = $mgr.GetCurrentSession() } catch {}

    if ($pending.IsCompleted) {
        $cmd = $pending.Result
        if ($null -eq $cmd) { break } # CLU closed our stdin
        if ($s) {
            try {
                switch ($cmd.Trim()) {
                    'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
                    'play'   { $null = Await ($s.TryPlayAsync()) ([bool]) }
                    'pause'  { $null = Await ($s.TryPauseAsync()) ([bool]) }
                    'next'   { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
                    'prev'   { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
                }
            } catch {}
        }
        $pending = $stdin.ReadLineAsync()
    }

    $state = @{ active = $false }
    if ($s) {
        try {
            $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $pb = $s.GetPlaybackInfo()
            $tl = $s.GetTimelineProperties()
            $key = "$($s.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
            # Artwork is sent once per track only; position updates stay tiny.
            $thumb = $null
            if ($key -ne $lastKey) { $lastKey = $key; $thumb = Thumb $props; if (-not $thumb) { $thumb = '' } }
            $state = @{
                active   = $true
                app      = $s.SourceAppUserModelId
                title    = $props.Title
                artist   = $props.Artist
                album    = $props.AlbumTitle
                status   = "$($pb.PlaybackStatus)"
                position = [int]$tl.Position.TotalSeconds
                duration = [int]$tl.EndTime.TotalSeconds
                updated  = [int64]($tl.LastUpdatedTime.ToUnixTimeMilliseconds())
                track    = $key
            }
            if ($null -ne $thumb) { $state.thumb = $thumb }
        } catch {}
    }
    $line = $state | ConvertTo-Json -Compress
    if ($line -ne $lastLine) { $lastLine = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
    Start-Sleep -Milliseconds 700
}
