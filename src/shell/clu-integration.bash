# CLU shell integration for bash: load the user's rc, then report cwd and the previous
# command's result on every prompt.
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

[ -n "$CLU_BANNER" ] && printf '%s\n' "$CLU_BANNER"
unset CLU_BANNER

__clu_esc() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; printf '%s' "$s" | tr -d '\000-\037'; }
__clu_last_hist=""

__clu_report_cwd() {
    local ec=$? line num cmd json
    printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-localhost}" "$PWD"
    line=$(HISTTIMEFORMAT= history 1)
    num=$(printf '%s' "$line" | awk '{print $1}')
    cmd=$(printf '%s' "$line" | sed -e 's/^ *[0-9]* *//')
    json="{\"t\":\"prompt\",\"p\":\"$(__clu_esc "$PWD")\""
    if [ -n "$num" ] && [ "$num" != "$__clu_last_hist" ]; then
        if [ -n "$__clu_last_hist" ]; then
            json="$json,\"last\":{\"cmd\":\"$(__clu_esc "$cmd")\",\"ok\":$([ $ec -eq 0 ] && echo true || echo false),\"code\":$ec,\"ms\":-1}"
        fi
        __clu_last_hist=$num
    fi
    printf '\033]7777;%s\007' "$(printf '%s}' "$json" | base64 | tr -d '\n')"
    return $ec
}
case "$PROMPT_COMMAND" in
    *__clu_report_cwd*) ;;
    *) PROMPT_COMMAND="__clu_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
