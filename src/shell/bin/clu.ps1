# Stand-alone `clu` for shells without the in-process integration (e.g. cmd.exe).
if ($args.Count -eq 0 -or $args[0] -in @('help', '-h', '--help', '/?')) {
    & (Join-Path $PSScriptRoot 'clu-help.ps1')
    exit 0
}
$payload = @{
    t     = 'cmd'
    token = $env:CLU_TOKEN
    cwd   = (Get-Location).ProviderPath
    args  = @($args | ForEach-Object { "$_" })
} | ConvertTo-Json -Compress
[Console]::Write("$([char]27)]7777;" + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($payload)) + "$([char]7)")
