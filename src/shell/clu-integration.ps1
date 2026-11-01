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

function global:prompt {
    $loc = $executionContext.SessionState.Path.CurrentLocation
    $osc = ''
    if ($loc.Provider.Name -eq 'FileSystem') {
        $osc = __clu_osc ('{"t":"cwd","p":' + (ConvertTo-Json -Compress $loc.ProviderPath) + '}')
    }
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
