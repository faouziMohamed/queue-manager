#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${WORKSPACE_ROOT:-$(pwd)}
ENV_FILE=${QUEUE_AGENT_ENV:-"$HOME/.config/queue-agent.env"}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

exec node "$HERE/server.mjs" "$ROOT" "${1:-}"
