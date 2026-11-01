$e = [char]27
$c = "$e[1;36m"; $d = "$e[2m"; $r = "$e[0m"; $b = "$e[1m"
Write-Host ""
Write-Host "  ${c}CLU$r ${d}- command line first, app when you need it$r"
$groups = [ordered]@{
    'LOOK' = @(
        @('clu theme [name|next|prev|list]', 'switch theme (no name opens the live picker)'),
        @('clu bg [name|next|prev|list]',    'background design: grid dots hex circuit scanlines rain none'),
        @('clu accent [color|next|reset]',   'accent color: cyan amber pink ... or ff8800 or 255,136,0'),
        @('clu font <size>',                 'terminal font size'),
        @('clu zen',                         'focus mode: terminal only'),
        @('clu fullscreen',                  'toggle fullscreen')
    )
    'FILES' = @(
        @('clu open <file>',                 'view inside CLU (image, video, audio, pdf, text)'),
        @('clu edit <file>',                 'built-in text editor (Ctrl+S saves)'),
        @('clu x <file|url>',                'open with the system default application'),
        @('clu fs [path]',                   'point the file browser somewhere (no path: follow shell)')
    )
    'APPS & WEB' = @(
        @('clu app [name]',                  'launch an installed app (no name: searchable list)'),
        @('clu pin <app|url> [name]',        'pin an app or website to the tab bar (e.g. clu pin spotify)'),
        @('clu unpin <name>',                'remove a pinned app'),
        @('clu web [url|search]',            'open a browser tab inside CLU')
    )
    'TERMINAL & SYSTEM' = @(
        @('clu tab [command]',               'new tab here, optionally running a command'),
        @('clu run <command>',               'type a command into the active tab (handy with bind)'),
        @('clu top',                         'process manager'),
        @('clu notify <text>',               'toast + system notification'),
        @('clu kb [on|off|en-US|tr-TR-Q]',   'on-screen keyboard'),
        @('clu sound [on|off]',              'sound effects')
    )
    'SHORTCUTS' = @(
        @('clu bind <keys> <command>',       'e.g. clu bind Ctrl+Alt+M theme matrix'),
        @('clu unbind <keys>',               'remove a custom shortcut'),
        @('clu keys',                        'list every shortcut (built-in + custom)')
    )
    'SECURITY' = @(
        @('clu lock',                        'lock CLU now (Ctrl+Alt+L)'),
        @('clu password [on|off]',           'change the startup password, or turn the lock on/off')
    )
    'APP' = @(
        @('clu settings',                    'settings editor (Ctrl+,)'),
        @('clu palette',                     'command palette (Ctrl+Shift+P)'),
        @('clu reload | clu quit',           'reload the UI / quit CLU')
    )
}
foreach ($g in $groups.Keys) {
    Write-Host ""
    Write-Host "  $b$g$r"
    foreach ($row in $groups[$g]) { Write-Host ("  {0,-34}{1}" -f $row[0], "$d$($row[1])$r") }
}
Write-Host ""
Write-Host "  ${d}Keys: Ctrl+Shift+G background · Ctrl+Shift+U accent · Ctrl+Shift+J theme (Ctrl+Alt+G/U = back)$r"
Write-Host "  ${d}      Ctrl+Shift+D launch app · Ctrl+Shift+N web tab · the ▾ button next to + pins apps$r"
Write-Host ""
