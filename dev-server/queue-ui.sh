#!/bin/sh
# Manage the queue dev server for one workspace: run, start, stop, restart, status, logs, open.
set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${WORKSPACE_ROOT:-$(pwd)}
ROOT=$(CDPATH= cd -- "$ROOT" && pwd)
COMMAND=${1:-status}
PORT=${2:-${PORT:-4317}}
URL="http://127.0.0.1:$PORT"
RUNTIME_DIR="$ROOT/.queue"
PID_FILE="$RUNTIME_DIR/dev-server.pid"
LOG_FILE="$RUNTIME_DIR/dev-server.log"
SERVER_MARK="dev-server/server.mjs $ROOT"

answers() {
  curl -fs -o /dev/null --max-time "${1:-1}" "$URL/" 2>/dev/null
}

running_pid() {
  _pid=""
  [ -f "$PID_FILE" ] && _pid=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$_pid" ] && kill -0 "$_pid" 2>/dev/null && ps -p "$_pid" -o args= 2>/dev/null | grep -qF "$SERVER_MARK"; then
    printf '%s\n' "$_pid"
    return 0
  fi
  _pid=$(pgrep -f "$SERVER_MARK" 2>/dev/null | head -n 1)
  [ -n "$_pid" ] && printf '%s\n' "$_pid"
}

start() {
  mkdir -p "$RUNTIME_DIR"
  pid=$(running_pid)
  if [ -n "$pid" ]; then
    printf 'Dev server already running (PID %s) at %s.\n' "$pid" "$URL"
    return 0
  fi
  rm -f "$PID_FILE"
  if answers 1; then
    printf 'Port %s is already serving something else. Stop it, or use another port: %s start 4318\n' "$PORT" "$0" >&2
    return 1
  fi
  printf 'Starting dev server at %s ...\n' "$URL"
  (cd "$ROOT" && WORKSPACE_ROOT="$ROOT" exec nohup sh "$HERE/serve.sh" "$PORT") > "$LOG_FILE" 2>&1 &
  printf '%s\n' "$!" > "$PID_FILE"
  i=0
  while [ "$i" -lt 40 ]; do
    if answers 1; then
      pid=$(running_pid)
      [ -n "$pid" ] && printf '%s\n' "$pid" > "$PID_FILE"
      printf 'Ready: %s\n' "$URL"
      return 0
    fi
    i=$((i + 1))
    sleep 0.25
  done
  printf 'Dev server did not answer; last log lines:\n' >&2
  tail -n 20 "$LOG_FILE" >&2 2>/dev/null
  return 1
}

stop() {
  pid=$(running_pid)
  if [ -z "$pid" ]; then
    printf 'No running dev server found for %s.\n' "$ROOT"
    rm -f "$PID_FILE"
    return 0
  fi
  printf 'Stopping dev server (PID %s) ...\n' "$pid"
  kill "$pid" 2>/dev/null
  i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do
    i=$((i + 1))
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then
    printf 'Force stopping ...\n'
    kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$PID_FILE"
}

status() {
  pid=$(running_pid)
  if [ -n "$pid" ]; then printf 'Dev server: running (PID %s, %s)\n' "$pid" "$URL"
  else printf 'Dev server: not running\n'
  fi
  if answers 2; then printf 'HTTP: ready on %s\n' "$URL"
  else printf 'HTTP: no answer on %s\n' "$URL"
  fi
}

open_browser() {
  start || return 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$URL"
  else printf 'Open %s in your browser.\n' "$URL"
  fi
}

case "$COMMAND" in
  run) cd "$ROOT" && WORKSPACE_ROOT="$ROOT" exec sh "$HERE/serve.sh" "$PORT" ;;
  start) start ;;
  stop) stop ;;
  restart) stop && start ;;
  status) status ;;
  logs)
    [ -f "$LOG_FILE" ] || { printf 'No log yet: %s\n' "$LOG_FILE" >&2; exit 2; }
    tail -n 40 -f "$LOG_FILE"
    ;;
  open) open_browser ;;
  *)
    printf 'Usage: %s <run|start|stop|restart|status|logs|open> [port]\n' "$0" >&2
    exit 2
    ;;
esac
