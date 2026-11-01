# CLU shell integration for Windows PowerShell / PowerShell 7.
# Reports the working directory to CLU on every prompt and defines the `clu` command.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $global:OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

if ($env:CLU_BANNER) {
    [Console]::WriteLine($env:CLU_BANNER)
    Remove-Item Env:CLU_BANNER
}

function global:__clu_osc([string]$json) {
    "$([char]27)]7777;" + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json)) + "$([char]7)"
}

$global:__clu_orig_prompt = $function:prompt
$global:__clu_last_hist = -1

# Every prompt reports: where we are, and how the previous command went (text, success,
# exit code, duration). CLU turns that into command blocks and long-command notifications.
function global:prompt {
    $ok = $?
    $lec = $global:LASTEXITCODE
    $loc = $executionContext.SessionState.Path.CurrentLocation
    $payload = @{ t = 'prompt' }
    if ($loc.Provider.Name -eq 'FileSystem') { $payload.p = $loc.ProviderPath }
    $h = Get-History -Count 1
    if ($h -and $h.Id -ne $global:__clu_last_hist) {
        $global:__clu_last_hist = $h.Id
        $code = if ($ok) { 0 } elseif ($lec) { $lec } else { 1 }
        $payload.last = @{ cmd = $h.CommandLine; ok = $ok; code = $code; ms = [int]($h.EndExecutionTime - $h.StartExecutionTime).TotalMilliseconds }
    }
    $osc = __clu_osc ($payload | ConvertTo-Json -Compress -Depth 3)
    $global:LASTEXITCODE = $lec
    $osc + (& $global:__clu_orig_prompt)
}

function global:clu {
    if ($args.Count -eq 0 -or $args[0] -in @('help', '-h', '--help', '/?')) {
        __clu_help
        return
    }
    $payload = @{
        t     = 'cmd'
        token = $env:CLU_TOKEN
        cwd   = $executionContext.SessionState.Path.CurrentLocation.ProviderPath
        args  = @($args | ForEach-Object { "$_" })
    }
    [Console]::Write((__clu_osc ($payload | ConvertTo-Json -Compress)))
}
