#!/bin/sh
# Portable task queue. No Node, no SQLite, no jq.
# Source of truth: .queue/<status>/<id>.md plus .queue/deps/* and .queue/next-id.

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SKILL_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

is_workspace_root() {
  [ -f "$1/CLAUDE.md" ] || [ -f "$1/AGENTS.md" ] || [ -d "$1/.queue" ]
}

find_workspace_root() {
  _fw_dir=$1
  while [ "$_fw_dir" != "/" ] && ! is_workspace_root "$_fw_dir"; do
    _fw_dir=$(dirname "$_fw_dir")
  done
  is_workspace_root "$_fw_dir" && printf '%s\n' "$_fw_dir"
}

ROOT=${WORKSPACE_ROOT:-}
[ -n "$ROOT" ] || ROOT=$(find_workspace_root "$(pwd)")
if [ -z "$ROOT" ] && [ "${1:-}" = "init" ]; then
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
fi
case "${1:-help}" in
  help|-h|--help) [ -n "$ROOT" ] || ROOT=$(pwd) ;;
esac
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  printf 'queue: cannot locate the workspace root (no .queue/, CLAUDE.md or AGENTS.md); run "queue.sh init" there or set WORKSPACE_ROOT\n' >&2
  exit 1
fi
QUEUE_DIR=${QUEUE_DIR:-"$ROOT/.queue"}
INDEX_FILE=${QUEUE_INDEX:-"$ROOT/QUEUE.md"}
HEADER_FILE="$QUEUE_DIR/header.md"
DEFAULT_HEADER="$SKILL_DIR/assets/header.md"
NEXT_ID_FILE="$QUEUE_DIR/next-id"
ACTIVE_FILE="$QUEUE_DIR/active"
DEPS_DIR="$QUEUE_DIR/deps"
STATUSES="ready in-progress blocked on-hold done"
TODAY=$(date +%Y-%m-%d)

die() { printf 'queue: %s\n' "$*" >&2; exit 1; }

usage() {
  printf 'Usage: sh %s <command> [options]\n' "$SCRIPT_DIR/queue.sh"
  cat <<'EOF'

  active                         Show the active tasks and their file paths
  path <id>                      Print the absolute path of a task body
  show <id>                      Print a task body and its dependencies
  add "Title" [options]          Create a task; prints its id
    --priority 1|2|3             Default 2
    --blocked-by Q-0001,Q-0002   Create the task as blocked
    --body-file path             Use a Markdown body template
    --resume "text"              Override the Resume line
    --start                      Start immediately (only if unblocked)
    --on-hold                    Create the task on hold
  start <id>                     Move a ready task to in-progress (up to wipLimit)
  block <id> --by Q-0001,...     Add blockers and mark it blocked
  unblock <id>                   Move to ready once every blocker is done
  hold <id>                      Park an open task on hold
  resume <id>                    Return a held task to ready
  done <id> [--summary "text"]   Mark done and auto-unblock dependents
  next                           Show up to five ready tasks
  list [--all]                   Print the queue table
  deps <id>                      Print both dependency directions
  index                          Regenerate QUEUE.md
  verify                         Check ids, statuses, edges and resume lines
  ui <run|start|stop|restart|status|logs|open> [port]
                                 Manage the browser dev server (default port 4317)
EOF
}

ensure_layout() {
  mkdir -p "$QUEUE_DIR/ready" "$QUEUE_DIR/in-progress" "$QUEUE_DIR/blocked" \
    "$QUEUE_DIR/on-hold" "$QUEUE_DIR/done" "$DEPS_DIR" || die "cannot create queue layout"
  [ -f "$NEXT_ID_FILE" ] || printf '1\n' > "$NEXT_ID_FILE"
  for _ignored in agent.env chats.sqlite chats.sqlite-wal chats.sqlite-shm dev-server.pid dev-server.port dev-server.log; do
    grep -qxF "$_ignored" "$QUEUE_DIR/.gitignore" 2>/dev/null || printf '%s\n' "$_ignored" >> "$QUEUE_DIR/.gitignore"
  done
  if [ ! -f "$HEADER_FILE" ] && [ -f "$DEFAULT_HEADER" ]; then
    _project=$(basename "$ROOT" | sed 's/[&|\\]/\\&/g')
    sed "s|{{project}}|$_project|g" "$DEFAULT_HEADER" > "$HEADER_FILE"
  fi
}

acquire_lock() {
  _lock_attempt=0
  while ! mkdir "$QUEUE_DIR/.lock" 2>/dev/null; do
    _lock_attempt=$((_lock_attempt + 1))
    if [ "$_lock_attempt" -ge 100 ]; then
      if find "$QUEUE_DIR/.lock" -mmin +1 -print -quit 2>/dev/null | grep -q .; then
        rmdir "$QUEUE_DIR/.lock" 2>/dev/null || true
        continue
      fi
      die "lock timeout"
    fi
    sleep 0.1 2>/dev/null || sleep 1
  done
  trap 'rmdir "$QUEUE_DIR/.lock" 2>/dev/null || true' EXIT INT TERM
}

release_lock() {
  rmdir "$QUEUE_DIR/.lock" 2>/dev/null || true
}

wip_limit() {
  # Matches the first positive integer assigned to "wipLimit" in config.json.
  _wl_value=$(sed -n 's/.*"wipLimit"[[:space:]]*:[[:space:]]*\([1-9][0-9]*\).*/\1/p' \
    "$QUEUE_DIR/config.json" 2>/dev/null | head -n 1)
  printf '%s\n' "${_wl_value:-1}"
}

active_ids() {
  [ -f "$ACTIVE_FILE" ] || return 0
  grep -v '^[[:space:]]*$' "$ACTIVE_FILE"
}

active_count() {
  active_ids | grep -c .
}

active_list() {
  active_ids | paste -sd ',' - | sed 's/,/, /g'
}

require_wip_slot() {
  _rw_limit=$(wip_limit)
  [ "$(active_count)" -lt "$_rw_limit" ] ||
    die "WIP limit $_rw_limit reached; active: $(active_list)"
}

add_active() {
  _aa_tmp="$ACTIVE_FILE.$$"
  { active_ids; printf '%s\n' "$1"; } > "$_aa_tmp" && mv "$_aa_tmp" "$ACTIVE_FILE"
}

remove_active() {
  [ -f "$ACTIVE_FILE" ] || return 0
  _ra_tmp="$ACTIVE_FILE.$$"
  grep -vxF "$1" "$ACTIVE_FILE" | grep -v '^[[:space:]]*$' > "$_ra_tmp"
  if [ -s "$_ra_tmp" ]; then
    mv "$_ra_tmp" "$ACTIVE_FILE"
  else
    rm -f "$_ra_tmp" "$ACTIVE_FILE"
  fi
}

valid_id() {
  case "$1" in Q-????*) ;; *) return 1 ;; esac
  _vi_digits=${1#Q-}
  [ "${#_vi_digits}" -ge 4 ] || return 1
  case "$_vi_digits" in *[!0-9]*) return 1 ;; esac
  return 0
}

find_task() {
  _find_id=$1
  for _find_status in ready in-progress blocked on-hold done; do
    if [ -f "$QUEUE_DIR/$_find_status/$_find_id.md" ]; then
      TASK_STATUS=$_find_status
      TASK_PATH="$QUEUE_DIR/$_find_status/$_find_id.md"
      return 0
    fi
  done
  return 1
}

require_task() {
  valid_id "$1" || die "invalid task id: $1"
  find_task "$1" || die "unknown task: $1"
}

meta() {
  sed -n "s/^$2: //p" "$1" | head -n 1
}

resume_of() {
  sed -n 's/^\*\*Resume:\*\* //p' "$1" | head -n 1
}

cell() {
  printf '%s' "$1" | sed 's/|/\\|/g' | tr '\n' ' '
}

set_meta() {
  _sm_file=$1
  _sm_key=$2
  _sm_value=$3
  _sm_tmp="$_sm_file.tmp.$$"
  awk -v k="$_sm_key" -v v="$_sm_value" '
    BEGIN { delims = 0; in_fm = 0 }
    /^---$/ {
      delims++
      if (delims == 1) in_fm = 1
      else if (delims == 2) in_fm = 0
      print
      next
    }
    in_fm && index($0, k ":") == 1 { print k ": " v; next }
    { print }
  ' "$_sm_file" > "$_sm_tmp" || { rm -f "$_sm_tmp"; die "cannot update $_sm_file"; }
  mv "$_sm_tmp" "$_sm_file"
}

set_resume() {
  _sr_file=$1
  _sr_value=$2
  _sr_tmp="$_sr_file.tmp.$$"
  awk -v v="$_sr_value" '
    { if ($0 ~ /^\*\*Resume:\*\*/) print "**Resume:** " v; else print }
  ' "$_sr_file" > "$_sr_tmp" || { rm -f "$_sr_tmp"; die "cannot update $_sr_file"; }
  mv "$_sr_tmp" "$_sr_file"
}

next_id() {
  cat "$NEXT_ID_FILE" 2>/dev/null || printf '1'
}

allocate_id() {
  _ai_next=$(next_id)
  case "$_ai_next" in
    ''|*[!0-9]*) die "invalid next-id: $_ai_next" ;;
  esac
  printf '%s\n' "$((_ai_next + 1))" > "$NEXT_ID_FILE"
  printf 'Q-%04d' "$_ai_next"
}

add_dep() {
  _ad_blocker=$1
  _ad_blocked=$2
  touch "$DEPS_DIR/$_ad_blocked.blocked-by" "$DEPS_DIR/$_ad_blocker.blocks"
  grep -qx "$_ad_blocker" "$DEPS_DIR/$_ad_blocked.blocked-by" ||
    printf '%s\n' "$_ad_blocker" >> "$DEPS_DIR/$_ad_blocked.blocked-by"
  grep -qx "$_ad_blocked" "$DEPS_DIR/$_ad_blocker.blocks" ||
    printf '%s\n' "$_ad_blocked" >> "$DEPS_DIR/$_ad_blocker.blocks"
}

remove_line() {
  _rl_file=$1
  _rl_line=$2
  [ -f "$_rl_file" ] || return 0
  _rl_tmp="$_rl_file.tmp.$$"
  grep -vx "$_rl_line" "$_rl_file" > "$_rl_tmp" || true
  mv "$_rl_tmp" "$_rl_file"
  [ -s "$_rl_file" ] || rm -f "$_rl_file"
}

remove_dep() {
  remove_line "$DEPS_DIR/$2.blocked-by" "$1"
  remove_line "$DEPS_DIR/$1.blocks" "$2"
}

replace_placeholders() {
  _rp_file=$1
  _rp_id=$2
  _rp_title=$3
  _rp_priority=$4
  awk -v id="$_rp_id" -v title="$_rp_title" -v priority="$_rp_priority" -v today="$TODAY" '
    function repl(s, from, to,   out, i) {
      out = ""
      while ((i = index(s, from)) > 0) {
        out = out substr(s, 1, i - 1) to
        s = substr(s, i + length(from))
      }
      return out s
    }
    {
      line = repl($0, "{{id}}", id)
      line = repl(line, "{{title}}", title)
      line = repl(line, "{{priority}}", priority)
      line = repl(line, "{{date}}", today)
      print line
    }
  ' "$_rp_file"
}

default_body() {
  cat <<'EOF'
# {{id}} — {{title}}

**Resume:** Define the next concrete action.

**Blocked by:** none · **Blocks:** none.

## Context to load

- `path` — why it matters.

## What was asked

...

## Acceptance criteria

- [ ] ...

## Definition of done

Optional; delete when the project's definition of done covers this task.

- [ ] ...

## Related pitfalls

...

## Progress

- [ ] ...

## What is left

- [ ] ...

## Settled (..., {{date}})

...

## Known, accepted, not a new defect

...
EOF
}

write_task_file() {
  _wt_file=$1
  _wt_id=$2
  _wt_title=$3
  _wt_priority=$4
  _wt_body=$5
  {
    printf '%s\n' '---'
    printf 'id: %s\n' "$_wt_id"
    printf 'title: %s\n' "$_wt_title"
    printf 'priority: %s\n' "$_wt_priority"
    printf 'created: %s\n' "$TODAY"
    printf 'updated: %s\n' "$TODAY"
    printf 'shipped:\n'
    printf 'summary:\n'
    printf '%s\n\n' '---'
    cat "$_wt_body"
  } > "$_wt_file" || die "cannot write $_wt_file"
}

index_queue() {
  _iq_tmp="$INDEX_FILE.tmp.$$"
  {
    if [ -f "$HEADER_FILE" ]; then
      cat "$HEADER_FILE"
    else
      printf '# Queue — %s\n' "$(basename "$ROOT")"
    fi

    printf '\n## Index\n\n'
    _iq_rows=0
    for _iq_status in in-progress ready blocked on-hold; do
      for _iq_file in "$QUEUE_DIR/$_iq_status"/*.md; do
        [ -f "$_iq_file" ] || continue
        if [ "$_iq_rows" -eq 0 ]; then
          printf '| ID | Title | Status | Priority | Updated | Resume |\n'
          printf '|---|---|---|---|---|---|\n'
        fi
        _iq_rows=$((_iq_rows + 1))
        _iq_id=$(basename "$_iq_file" .md)
        printf '| %s | %s | %s | %s | %s | %s |\n' \
          "$_iq_id" \
          "$(cell "$(meta "$_iq_file" title)")" \
          "$_iq_status" \
          "$(meta "$_iq_file" priority)" \
          "$(meta "$_iq_file" updated)" \
          "$(cell "$(resume_of "$_iq_file")")"
      done
    done
    [ "$_iq_rows" -eq 0 ] && printf '_No open tasks._\n'

    printf '\n## Next up\n\n'
    _iq_next=$(
      for _iq_file in "$QUEUE_DIR/ready"/*.md; do
        [ -f "$_iq_file" ] || continue
        _iq_id=$(basename "$_iq_file" .md)
        [ -s "$DEPS_DIR/$_iq_id.blocked-by" ] && continue
        printf '%s|%s|%s|%s|%s\n' \
          "$(meta "$_iq_file" priority)" \
          "$(meta "$_iq_file" created)" \
          "$_iq_id" \
          "$(meta "$_iq_file" title)" \
          "$(resume_of "$_iq_file")"
      done | sort -t'|' -k1,1n -k2,2 -k3,3 | head -n 5
    )
    if [ -n "$_iq_next" ]; then
      printf '%s\n' "$_iq_next" | while IFS='|' read -r _p _c _id _title _resume; do
        printf '%s\n' "- $_id — $_title — $_resume"
      done
    else
      printf '_No ready tasks._\n'
    fi

    printf '\n## Blocked\n\n'
    _iq_blocked=0
    for _iq_file in "$QUEUE_DIR/blocked"/*.md; do
      [ -f "$_iq_file" ] || continue
      _iq_blocked=$((_iq_blocked + 1))
      _iq_id=$(basename "$_iq_file" .md)
      if [ -f "$DEPS_DIR/$_iq_id.blocked-by" ]; then
        _iq_by=$(tr '\n' ',' < "$DEPS_DIR/$_iq_id.blocked-by" | sed 's/,$//')
      else
        _iq_by=''
      fi
      [ -n "$_iq_by" ] || _iq_by='unknown'
      printf '%s\n' "- $_iq_id — $(meta "$_iq_file" title) — blocked by $_iq_by"
    done
    [ "$_iq_blocked" -eq 0 ] && printf '_No blocked tasks._\n'

    printf '\n## On hold\n\n'
    _iq_held=0
    for _iq_file in "$QUEUE_DIR/on-hold"/*.md; do
      [ -f "$_iq_file" ] || continue
      _iq_held=$((_iq_held + 1))
      _iq_id=$(basename "$_iq_file" .md)
      if [ -s "$DEPS_DIR/$_iq_id.blocked-by" ]; then
        _iq_by=$(tr '\n' ',' < "$DEPS_DIR/$_iq_id.blocked-by" | sed 's/,$//')
        printf '%s\n' "- $_iq_id — $(meta "$_iq_file" title) — blocked by $_iq_by"
      else
        printf '%s\n' "- $_iq_id — $(meta "$_iq_file" title)"
      fi
    done
    [ "$_iq_held" -eq 0 ] && printf '_No tasks on hold._\n'

    printf '\n## Awaiting production\n\n'
    _iq_prod_gates=''
    for _iq_status in $STATUSES; do
      for _iq_file in "$QUEUE_DIR/$_iq_status"/*.md; do
        [ -f "$_iq_file" ] || continue
        [ "$(meta "$_iq_file" prod_gate)" = 'true' ] || continue
        _iq_prod_gates="$_iq_prod_gates $(basename "$_iq_file" .md)"
      done
    done
    _iq_awaiting=''
    for _iq_status in in-progress ready blocked on-hold; do
      for _iq_file in "$QUEUE_DIR/$_iq_status"/*.md; do
        [ -f "$_iq_file" ] || continue
        _iq_id=$(basename "$_iq_file" .md)
        [ -s "$DEPS_DIR/$_iq_id.blocked-by" ] || continue
        for _iq_gate in $_iq_prod_gates; do
          if grep -qx "$_iq_gate" "$DEPS_DIR/$_iq_id.blocked-by"; then
            _iq_awaiting="$_iq_awaiting$(printf '%s|%s|%s|%s' \
              "$(meta "$_iq_file" priority)" "$(meta "$_iq_file" created)" \
              "$_iq_id" "$_iq_gate")
"
            break
          fi
        done
      done
    done
    if [ -n "$_iq_awaiting" ]; then
      printf '%s\n' "$_iq_awaiting" | sort -t'|' -k1,1n -k2,2 -k3,3 |
        while IFS='|' read -r _p _c _id _gate; do
          [ -n "$_id" ] || continue
          find_task "$_id" || continue
          printf -- '- %s — %s — awaiting production (%s) — %s\n' \
            "$_id" "$(meta "$TASK_PATH" title)" "$_gate" "$(resume_of "$TASK_PATH")"
        done
    else
      printf '_No tasks awaiting production._\n'
    fi

  } > "$_iq_tmp" || { rm -f "$_iq_tmp"; die "cannot write $_iq_tmp"; }
  mv "$_iq_tmp" "$INDEX_FILE" || die "cannot replace $INDEX_FILE"
}

cmd_init() {
  ensure_layout
  if [ ! -f "$QUEUE_DIR/agent.env" ] && [ -f "$SKILL_DIR/assets/agent.env.example" ]; then
    (umask 077 && cp "$SKILL_DIR/assets/agent.env.example" "$QUEUE_DIR/agent.env")
  fi
  acquire_lock
  index_queue
  release_lock
  printf '%s\n' "$QUEUE_DIR"
}

cmd_active() {
  _ac_ids=$(active_ids)
  if [ -z "$_ac_ids" ]; then
    printf 'No active task.\n'
    return 0
  fi
  _ac_first=yes
  for _ac_id in $_ac_ids; do
    require_task "$_ac_id"
    [ "$TASK_STATUS" = in-progress ] || die "active id $_ac_id is in $TASK_STATUS"
    [ "$_ac_first" = yes ] || printf '\n'
    _ac_first=no
    printf '%s — %s\n' "$_ac_id" "$(meta "$TASK_PATH" title)"
    printf 'Status: %s | Priority: %s | Updated: %s\n' \
      "$TASK_STATUS" "$(meta "$TASK_PATH" priority)" "$(meta "$TASK_PATH" updated)"
    printf 'Path: %s\n' "$TASK_PATH"
    printf 'Resume: %s\n' "$(resume_of "$TASK_PATH")"
  done
}

cmd_path() {
  [ $# -ge 1 ] || die 'path requires a task id'
  require_task "$1"
  printf '%s\n' "$TASK_PATH"
}

cmd_show() {
  [ $# -ge 1 ] || die 'show requires a task id'
  require_task "$1"
  _sh_id=$1
  cat "$TASK_PATH"
  printf '\n---\nStatus: %s\nPath: %s\n' "$TASK_STATUS" "$TASK_PATH"
  if [ -s "$DEPS_DIR/$_sh_id.blocked-by" ]; then
    printf 'Blocked by: %s\n' "$(tr '\n' ' ' < "$DEPS_DIR/$_sh_id.blocked-by")"
  else
    printf 'Blocked by: none\n'
  fi
  if [ -s "$DEPS_DIR/$_sh_id.blocks" ]; then
    printf 'Blocks: %s\n' "$(tr '\n' ' ' < "$DEPS_DIR/$_sh_id.blocks")"
  else
    printf 'Blocks: none\n'
  fi
}

cmd_add() {
  _add_title=''
  _add_priority=2
  _add_blocked_by=''
  _add_body_file=''
  _add_resume=''
  _add_start=no
  _add_on_hold=no

  while [ $# -gt 0 ]; do
    case "$1" in
      --priority) [ $# -ge 2 ] || die '--priority needs a value'; _add_priority=$2; shift 2 ;;
      --blocked-by) [ $# -ge 2 ] || die '--blocked-by needs a value'; _add_blocked_by=$2; shift 2 ;;
      --body-file) [ $# -ge 2 ] || die '--body-file needs a value'; _add_body_file=$2; shift 2 ;;
      --resume) [ $# -ge 2 ] || die '--resume needs a value'; _add_resume=$2; shift 2 ;;
      --start) _add_start=yes; shift ;;
      --on-hold) _add_on_hold=yes; shift ;;
      *) _add_title="$_add_title $1"; shift ;;
    esac
  done
  _add_title=$(printf '%s' "$_add_title" | sed 's/^ *//; s/ *$//' | tr '\n' ' ')
  [ -n "$_add_title" ] || die 'add requires a title'
  case "$_add_priority" in 1|2|3) ;; *) die '--priority must be 1, 2 or 3' ;; esac
  if [ "$_add_start" = yes ] && [ -n "$_add_blocked_by" ]; then
    die 'cannot start a blocked task'
  fi
  if [ "$_add_on_hold" = yes ] && [ "$_add_start" = yes ]; then
    die 'cannot start a task on hold'
  fi
  if [ "$_add_on_hold" = yes ] && [ -n "$_add_blocked_by" ]; then
    die 'cannot create a held task with blockers; add the task, block it, then hold it'
  fi

  ensure_layout
  acquire_lock
  [ "$_add_start" = yes ] && require_wip_slot

  _add_blockers=''
  if [ -n "$_add_blocked_by" ]; then
    for _add_blocker in $(printf '%s' "$_add_blocked_by" | tr ',' ' '); do
      _add_blocker=$(printf '%s' "$_add_blocker" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')
      valid_id "$_add_blocker" || die "invalid blocker id: $_add_blocker"
      find_task "$_add_blocker" || die "unknown blocker: $_add_blocker"
      [ "$TASK_STATUS" = done ] && die "blocker already done: $_add_blocker"
      _add_blockers="$_add_blockers $_add_blocker"
    done
  fi

  _add_id=$(allocate_id)
  if [ "$_add_start" = yes ]; then
    _add_status=in-progress
  elif [ -n "$_add_blocked_by" ]; then
    _add_status=blocked
  elif [ "$_add_on_hold" = yes ]; then
    _add_status=on-hold
  else
    _add_status=ready
  fi
  _add_file="$QUEUE_DIR/$_add_status/$_add_id.md"

  _add_raw="$QUEUE_DIR/.raw.$$"
  _add_body="$QUEUE_DIR/.body.$$"
  if [ -n "$_add_body_file" ]; then
    [ -f "$_add_body_file" ] || die "body file not found: $_add_body_file"
    replace_placeholders "$_add_body_file" "$_add_id" "$_add_title" "$_add_priority" > "$_add_raw"
  else
    _add_default="$QUEUE_DIR/.default.$$"
    default_body > "$_add_default"
    replace_placeholders "$_add_default" "$_add_id" "$_add_title" "$_add_priority" > "$_add_raw"
    rm -f "$_add_default"
  fi
  awk 'BEGIN { delims = 0; in_fm = 0 }
       /^---$/ {
         delims++
         if (delims == 1) { in_fm = 1; next }
         if (delims == 2) { in_fm = 0; next }
       }
       !in_fm { print }' "$_add_raw" > "$_add_body"
  rm -f "$_add_raw"
  write_task_file "$_add_file" "$_add_id" "$_add_title" "$_add_priority" "$_add_body"
  rm -f "$_add_body"

  if [ -n "$_add_resume" ]; then
    set_resume "$_add_file" "$_add_resume"
  fi

  for _add_blocker in $_add_blockers; do
    add_dep "$_add_blocker" "$_add_id"
  done

  if [ "$_add_start" = yes ]; then
    add_active "$_add_id"
  fi
  release_lock
  index_queue
  printf '%s\n' "$_add_id"
}

cmd_start() {
  [ $# -ge 1 ] || die 'start requires a task id'
  _st_id=$1
  ensure_layout
  acquire_lock
  require_task "$_st_id"
  if [ "$TASK_STATUS" = in-progress ]; then
    release_lock
    printf '%s\n' "$_st_id in progress"
    return 0
  fi
  [ "$TASK_STATUS" = ready ] || die "$_st_id is $TASK_STATUS, not ready"
  require_wip_slot
  if [ -s "$DEPS_DIR/$_st_id.blocked-by" ]; then
    while IFS= read -r _st_blocker; do
      [ -n "$_st_blocker" ] || continue
      find_task "$_st_blocker" || die "unknown blocker: $_st_blocker"
      [ "$TASK_STATUS" = done ] || die "$_st_id is blocked by $_st_blocker"
    done < "$DEPS_DIR/$_st_id.blocked-by"
  fi
  mv "$QUEUE_DIR/ready/$_st_id.md" "$QUEUE_DIR/in-progress/$_st_id.md" ||
    die "cannot start $_st_id"
  set_meta "$QUEUE_DIR/in-progress/$_st_id.md" updated "$TODAY"
  add_active "$_st_id"
  release_lock
  index_queue
  printf '%s\n' "$_st_id in progress"
}

cmd_block() {
  [ $# -ge 1 ] || die 'block requires a task id'
  _bl_id=$1
  shift
  _bl_by=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --by) [ $# -ge 2 ] || die '--by needs a value'; _bl_by=$2; shift 2 ;;
      *) die "unknown option: $1" ;;
    esac
  done
  [ -n "$_bl_by" ] || die 'block requires --by Q-0001[,Q-0002]'

  ensure_layout
  acquire_lock
  require_task "$_bl_id"
  [ "$TASK_STATUS" = done ] && die "$_bl_id is already done"
  _bl_from=$TASK_STATUS
  [ "$_bl_from" = on-hold ] && die "$_bl_id is on hold; resume it before blocking"

  _bl_blockers=''
  for _bl_blocker in $(printf '%s' "$_bl_by" | tr ',' ' '); do
    _bl_blocker=$(printf '%s' "$_bl_blocker" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')
    [ "$_bl_blocker" = "$_bl_id" ] && die 'a task cannot block itself'
    valid_id "$_bl_blocker" || die "invalid blocker id: $_bl_blocker"
    find_task "$_bl_blocker" || die "unknown blocker: $_bl_blocker"
    [ "$TASK_STATUS" = done ] && die "blocker already done: $_bl_blocker"
    _bl_blockers="$_bl_blockers $_bl_blocker"
  done
  for _bl_blocker in $_bl_blockers; do
    add_dep "$_bl_blocker" "$_bl_id"
  done

  [ "$_bl_from" = in-progress ] && remove_active "$_bl_id"
  if [ "$_bl_from" != blocked ]; then
    mv "$QUEUE_DIR/$_bl_from/$_bl_id.md" "$QUEUE_DIR/blocked/$_bl_id.md" ||
      die "cannot block $_bl_id"
  fi
  set_meta "$QUEUE_DIR/blocked/$_bl_id.md" updated "$TODAY"
  release_lock
  index_queue
  printf '%s blocked\n' "$_bl_id"
}

cmd_unblock() {
  [ $# -ge 1 ] || die 'unblock requires a task id'
  _ub_id=$1
  ensure_layout
  acquire_lock
  require_task "$_ub_id"
  [ "$TASK_STATUS" = blocked ] || die "$_ub_id is $TASK_STATUS, not blocked"

  if [ -s "$DEPS_DIR/$_ub_id.blocked-by" ]; then
    _ub_list="$DEPS_DIR/.unblock.$$"
    cp "$DEPS_DIR/$_ub_id.blocked-by" "$_ub_list"
    while IFS= read -r _ub_blocker; do
      [ -n "$_ub_blocker" ] || continue
      find_task "$_ub_blocker" || die "unknown blocker: $_ub_blocker"
      [ "$TASK_STATUS" = done ] || die "still blocked by $_ub_blocker"
    done < "$_ub_list"
    while IFS= read -r _ub_blocker; do
      [ -n "$_ub_blocker" ] || continue
      remove_dep "$_ub_blocker" "$_ub_id"
    done < "$_ub_list"
    rm -f "$_ub_list"
  fi
  rm -f "$DEPS_DIR/$_ub_id.blocked-by"
  mv "$QUEUE_DIR/blocked/$_ub_id.md" "$QUEUE_DIR/ready/$_ub_id.md" ||
    die "cannot unblock $_ub_id"
  set_meta "$QUEUE_DIR/ready/$_ub_id.md" updated "$TODAY"
  release_lock
  index_queue
  printf '%s ready\n' "$_ub_id"
}

cmd_hold() {
  [ $# -ge 1 ] || die 'hold requires a task id'
  _hd_id=$1
  ensure_layout
  acquire_lock
  require_task "$_hd_id"
  if [ "$TASK_STATUS" = on-hold ]; then
    release_lock
    printf '%s already on hold\n' "$_hd_id"
    return 0
  fi
  [ "$TASK_STATUS" = done ] && die "$_hd_id is already done"
  _hd_from=$TASK_STATUS
  [ "$_hd_from" = in-progress ] && remove_active "$_hd_id"
  mv "$QUEUE_DIR/$_hd_from/$_hd_id.md" "$QUEUE_DIR/on-hold/$_hd_id.md" ||
    die "cannot hold $_hd_id"
  set_meta "$QUEUE_DIR/on-hold/$_hd_id.md" updated "$TODAY"
  release_lock
  index_queue
  printf '%s on hold\n' "$_hd_id"
}

cmd_resume() {
  [ $# -ge 1 ] || die 'resume requires a task id'
  _rs_id=$1
  ensure_layout
  acquire_lock
  require_task "$_rs_id"
  [ "$TASK_STATUS" = on-hold ] || die "$_rs_id is $TASK_STATUS, not on hold"
  if [ -s "$DEPS_DIR/$_rs_id.blocked-by" ]; then
    while IFS= read -r _rs_blocker; do
      [ -n "$_rs_blocker" ] || continue
      find_task "$_rs_blocker" || die "unknown blocker: $_rs_blocker"
      [ "$TASK_STATUS" = done ] || die "$_rs_id is blocked by $_rs_blocker"
    done < "$DEPS_DIR/$_rs_id.blocked-by"
  fi
  mv "$QUEUE_DIR/on-hold/$_rs_id.md" "$QUEUE_DIR/ready/$_rs_id.md" ||
    die "cannot resume $_rs_id"
  set_meta "$QUEUE_DIR/ready/$_rs_id.md" updated "$TODAY"
  release_lock
  index_queue
  printf '%s ready\n' "$_rs_id"
}

cmd_done() {
  [ $# -ge 1 ] || die 'done requires a task id'
  _dn_id=$1
  shift
  _dn_summary=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --summary) [ $# -ge 2 ] || die '--summary needs a value'; _dn_summary=$2; shift 2 ;;
      *) die "unknown option: $1" ;;
    esac
  done

  ensure_layout
  acquire_lock
  require_task "$_dn_id"
  if [ "$TASK_STATUS" = done ]; then
    release_lock
    printf '%s already done\n' "$_dn_id"
    return 0
  fi
  _dn_from=$TASK_STATUS
  _dn_path=$TASK_PATH

  [ "$_dn_from" = in-progress ] && remove_active "$_dn_id"
  mv "$_dn_path" "$QUEUE_DIR/done/$_dn_id.md" || die "cannot finish $_dn_id"
  _dn_path="$QUEUE_DIR/done/$_dn_id.md"
  set_meta "$_dn_path" updated "$TODAY"
  set_meta "$_dn_path" shipped "$TODAY"
  set_meta "$_dn_path" summary "$_dn_summary"

  _dn_blocks="$DEPS_DIR/$_dn_id.blocks"
  if [ -s "$_dn_blocks" ]; then
    _dn_list="$DEPS_DIR/.done.$$"
    cp "$_dn_blocks" "$_dn_list"
    while IFS= read -r _dn_dependent; do
      [ -n "$_dn_dependent" ] || continue
      remove_dep "$_dn_id" "$_dn_dependent"
      if [ ! -s "$DEPS_DIR/$_dn_dependent.blocked-by" ]; then
        if find_task "$_dn_dependent"; then
          # Held dependents stay on hold; only blocked ones become ready.
          if [ "$TASK_STATUS" = blocked ]; then
            mv "$QUEUE_DIR/blocked/$_dn_dependent.md" "$QUEUE_DIR/ready/$_dn_dependent.md"
            set_meta "$QUEUE_DIR/ready/$_dn_dependent.md" updated "$TODAY"
          fi
        fi
      fi
    done < "$_dn_list"
    rm -f "$_dn_list"
  fi
  rm -f "$DEPS_DIR/$_dn_id.blocks" "$DEPS_DIR/$_dn_id.blocked-by"
  release_lock
  index_queue
  printf '%s done\n' "$_dn_id"
}

cmd_next() {
  _nx_rows=$(
    for _nx_file in "$QUEUE_DIR/ready"/*.md; do
      [ -f "$_nx_file" ] || continue
      _nx_id=$(basename "$_nx_file" .md)
      [ -s "$DEPS_DIR/$_nx_id.blocked-by" ] && continue
      printf '%s|%s|%s|%s|%s\n' \
        "$(meta "$_nx_file" priority)" \
        "$(meta "$_nx_file" created)" \
        "$_nx_id" \
        "$(meta "$_nx_file" title)" \
        "$(resume_of "$_nx_file")"
    done | sort -t'|' -k1,1n -k2,2 -k3,3 | head -n 5
  )
  if [ -z "$_nx_rows" ]; then
    printf 'No ready task.\n'
    return 0
  fi
  printf '%s\n' "$_nx_rows" | while IFS='|' read -r _p _c _id _title _resume; do
    printf '%s — %s — %s\n' "$_id" "$_title" "$_resume"
  done
}

cmd_list() {
  _ls_all=no
  [ "${1:-}" = '--all' ] && _ls_all=yes
  printf '| ID | Status | P | Updated | Title | Resume |\n'
  printf '|---|---|---|---|---|---|\n'
  _ls_rows=0
  for _ls_status in in-progress ready blocked on-hold done; do
    [ "$_ls_all" = yes ] || [ "$_ls_status" != done ] || continue
    for _ls_file in "$QUEUE_DIR/$_ls_status"/*.md; do
      [ -f "$_ls_file" ] || continue
      _ls_rows=$((_ls_rows + 1))
      _ls_id=$(basename "$_ls_file" .md)
      printf '| %s | %s | %s | %s | %s | %s |\n' \
        "$_ls_id" "$_ls_status" \
        "$(meta "$_ls_file" priority)" \
        "$(meta "$_ls_file" updated)" \
        "$(cell "$(meta "$_ls_file" title)")" \
        "$(cell "$(resume_of "$_ls_file")")"
    done
  done
  [ "$_ls_rows" -eq 0 ] && printf '_No tasks._\n'
  return 0
}

cmd_deps() {
  [ $# -ge 1 ] || die 'deps requires a task id'
  _dp_id=$1
  require_task "$_dp_id"
  if [ -s "$DEPS_DIR/$_dp_id.blocked-by" ]; then
    printf 'Blocked by:\n'
    sed 's/^/  /' "$DEPS_DIR/$_dp_id.blocked-by"
  else
    printf 'Blocked by: none\n'
  fi
  if [ -s "$DEPS_DIR/$_dp_id.blocks" ]; then
    printf 'Blocks:\n'
    sed 's/^/  /' "$DEPS_DIR/$_dp_id.blocks"
  else
    printf 'Blocks: none\n'
  fi
}

cmd_verify() {
  _vf_errors=0
  fail() {
    printf 'FAIL %s\n' "$*" >&2
    _vf_errors=$((_vf_errors + 1))
  }

  _vf_max=0
  for _vf_status in $STATUSES; do
    for _vf_file in "$QUEUE_DIR/$_vf_status"/*.md; do
      [ -f "$_vf_file" ] || continue
      _vf_base=$(basename "$_vf_file" .md)
      valid_id "$_vf_base" || { fail "invalid task filename: $_vf_base"; continue; }
      _vf_meta_id=$(meta "$_vf_file" id)
      [ "$_vf_meta_id" = "$_vf_base" ] || fail "$_vf_base: frontmatter id is '$_vf_meta_id'"
      [ -n "$(resume_of "$_vf_file")" ] || fail "$_vf_base: body has no Resume line"
      if [ "$_vf_status" = done ]; then
        [ -n "$(meta "$_vf_file" shipped)" ] || fail "$_vf_base: done without shipped date"
      else
        [ -z "$(meta "$_vf_file" shipped)" ] || fail "$_vf_base: shipped date on an open task"
      fi
      _vf_num=$(printf '%s' "$_vf_base" | sed 's/^Q-//; s/^0*//')
      _vf_num=${_vf_num:-0}
      [ "$_vf_num" -gt "$_vf_max" ] && _vf_max=$_vf_num
    done
  done

  _vf_next=$(next_id)
  case "$_vf_next" in
    ''|*[!0-9]*) fail "invalid next-id: $_vf_next" ;;
    *) [ "$_vf_next" -gt "$_vf_max" ] || fail "next-id $_vf_next must exceed max id $_vf_max" ;;
  esac

  _vf_inprog=0
  for _vf_file in "$QUEUE_DIR/in-progress"/*.md; do
    [ -f "$_vf_file" ] || continue
    _vf_inprog=$((_vf_inprog + 1))
  done
  _vf_limit=$(wip_limit)
  [ "$_vf_inprog" -le "$_vf_limit" ] ||
    fail "$_vf_inprog in-progress tasks exceed the WIP limit of $_vf_limit"

  for _vf_active in $(active_ids); do
    valid_id "$_vf_active" || fail "invalid active id: $_vf_active"
    if find_task "$_vf_active"; then
      [ "$TASK_STATUS" = in-progress ] || fail "active id $_vf_active is in $TASK_STATUS"
    else
      fail "active id $_vf_active does not exist"
    fi
  done
  [ -z "$(active_ids | sort | uniq -d)" ] || fail "duplicate ids in the active file"

  for _vf_file in "$DEPS_DIR"/*.blocked-by; do
    [ -f "$_vf_file" ] || continue
    _vf_blocked=$(basename "$_vf_file" .blocked-by)
    valid_id "$_vf_blocked" || fail "invalid dependency filename: $_vf_blocked"
    find_task "$_vf_blocked" || fail "$_vf_blocked: dependency file for a missing task"
    while IFS= read -r _vf_blocker; do
      [ -n "$_vf_blocker" ] || continue
      valid_id "$_vf_blocker" || fail "invalid blocker id: $_vf_blocker"
      [ "$_vf_blocker" = "$_vf_blocked" ] && fail "$_vf_blocked: self dependency"
      find_task "$_vf_blocker" || fail "$_vf_blocked: unknown blocker $_vf_blocker"
      grep -qx "$_vf_blocked" "$DEPS_DIR/$_vf_blocker.blocks" 2>/dev/null ||
        fail "asymmetry: $_vf_blocker does not list $_vf_blocked"
    done < "$_vf_file"
  done

  for _vf_file in "$DEPS_DIR"/*.blocks; do
    [ -f "$_vf_file" ] || continue
    _vf_blocker=$(basename "$_vf_file" .blocks)
    valid_id "$_vf_blocker" || fail "invalid dependency filename: $_vf_blocker"
    while IFS= read -r _vf_blocked; do
      [ -n "$_vf_blocked" ] || continue
      grep -qx "$_vf_blocker" "$DEPS_DIR/$_vf_blocked.blocked-by" 2>/dev/null ||
        fail "asymmetry: $_vf_blocked does not list $_vf_blocker"
    done < "$_vf_file"
  done

  for _vf_status in ready blocked; do
    for _vf_file in "$QUEUE_DIR/$_vf_status"/*.md; do
      [ -f "$_vf_file" ] || continue
      _vf_id=$(basename "$_vf_file" .md)
      _vf_unresolved=0
      if [ -s "$DEPS_DIR/$_vf_id.blocked-by" ]; then
        while IFS= read -r _vf_blocker; do
          [ -n "$_vf_blocker" ] || continue
          if find_task "$_vf_blocker"; then
            [ "$TASK_STATUS" = done ] || _vf_unresolved=$((_vf_unresolved + 1))
          else
            _vf_unresolved=$((_vf_unresolved + 1))
          fi
        done < "$DEPS_DIR/$_vf_id.blocked-by"
      fi
      [ "$_vf_status" = ready ] && [ "$_vf_unresolved" -gt 0 ] &&
        fail "$_vf_id: ready but has $_vf_unresolved unresolved blocker(s)"
      [ "$_vf_status" = blocked ] && [ "$_vf_unresolved" -eq 0 ] &&
        fail "$_vf_id: blocked without an unresolved blocker"
    done
  done

  _vf_edges="$DEPS_DIR/.edges.$$"
  : > "$_vf_edges"
  for _vf_file in "$DEPS_DIR"/*.blocked-by; do
    [ -f "$_vf_file" ] || continue
    _vf_blocked=$(basename "$_vf_file" .blocked-by)
    while IFS= read -r _vf_blocker; do
      [ -n "$_vf_blocker" ] && printf '%s %s\n' "$_vf_blocker" "$_vf_blocked" >> "$_vf_edges"
    done < "$_vf_file"
  done
  if [ -s "$_vf_edges" ]; then
    awk '
      {
        nodes[$1] = 1; nodes[$2] = 1
        indeg[$2]++
        if (out[$1] == "") out[$1] = $2
        else out[$1] = out[$1] " " $2
      }
      END {
        qn = 0
        for (n in nodes) if (!(n in indeg)) q[qn++] = n
        processed = 0
        for (i = 0; i < qn; i++) {
          n = q[i]
          processed++
          count = split(out[n], a, " ")
          for (j = 1; j <= count; j++) {
            m = a[j]
            indeg[m]--
            if (indeg[m] == 0) q[qn++] = m
          }
        }
        total = 0
        for (n in nodes) total++
        if (processed < total) { print "dependency cycle detected"; exit 1 }
      }
    ' "$_vf_edges" || fail "dependency cycle detected"
  fi
  rm -f "$_vf_edges"

  if [ "$_vf_errors" -eq 0 ]; then
    printf 'PASS queue integrity\n'
  else
    printf 'FAIL queue integrity: %s issue(s)\n' "$_vf_errors" >&2
    exit 1
  fi
}

cmd_index() {
  ensure_layout
  acquire_lock
  index_queue
  release_lock
  printf '%s\n' "$INDEX_FILE"
}

cmd=${1:-help}
[ $# -gt 0 ] && shift

case "$cmd" in
  help|-h|--help) usage ;;
  init) cmd_init ;;
  active) cmd_active ;;
  path) cmd_path "$@" ;;
  show) cmd_show "$@" ;;
  add) cmd_add "$@" ;;
  start) cmd_start "$@" ;;
  block) cmd_block "$@" ;;
  unblock) cmd_unblock "$@" ;;
  hold) cmd_hold "$@" ;;
  resume) cmd_resume "$@" ;;
  done) cmd_done "$@" ;;
  next) cmd_next ;;
  list) cmd_list "$@" ;;
  deps) cmd_deps "$@" ;;
  index) cmd_index ;;
  verify) ensure_layout; cmd_verify ;;
  ui) WORKSPACE_ROOT="$ROOT" exec sh "$SKILL_DIR/dev-server/queue-ui.sh" "$@" ;;
  *) usage; exit 1 ;;
esac
