# CLU shell integration for bash: load the user's rc, then report cwd on every prompt.
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

[ -n "$CLU_BANNER" ] && printf '%s\n' "$CLU_BANNER"
unset CLU_BANNER

__clu_report_cwd() {
    printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-localhost}" "$PWD"
}
case "$PROMPT_COMMAND" in
    *__clu_report_cwd*) ;;
    *) PROMPT_COMMAND="__clu_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
