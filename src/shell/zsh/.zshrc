# CLU shell integration for zsh: restore the user's ZDOTDIR, load their rc, report cwd.
ZDOTDIR="${CLU_ORIG_ZDOTDIR:-$HOME}"
[ -f "$ZDOTDIR/.zshrc" ] && . "$ZDOTDIR/.zshrc"

[ -n "$CLU_BANNER" ] && printf '%s\n' "$CLU_BANNER"
unset CLU_BANNER

__clu_report_cwd() {
    printf '\033]7;file://%s%s\033\\' "${HOST:-localhost}" "$PWD"
}
autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd __clu_report_cwd
