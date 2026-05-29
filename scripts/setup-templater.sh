#!/usr/bin/env bash
set -euo pipefail

# Scaffold Templater templates + optional mapping snippet for Google Sync users.
# Usage:
#   ./scripts/setup-templater.sh /path/to/vault
#   ./scripts/setup-templater.sh /path/to/vault --configure-templater

VAULT_PATH="${1:-}"
CONFIGURE=false

if [[ -z "$VAULT_PATH" ]]; then
  echo "Usage: $0 /absolute/or/relative/vault/path [--configure-templater]"
  exit 1
fi

if [[ "${2:-}" == "--configure-templater" ]]; then
  CONFIGURE=true
fi

VAULT_PATH="$(python3 - <<'PY' "$VAULT_PATH"
import os,sys
print(os.path.abspath(sys.argv[1]))
PY
)"

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "Vault path does not exist: $VAULT_PATH"
  exit 1
fi

TEMPLATES_DIR="$VAULT_PATH/templates/google-sync"
EVENTS_DIR="$VAULT_PATH/events"
TASKS_DIR="$VAULT_PATH/tasks"

mkdir -p "$TEMPLATES_DIR" "$EVENTS_DIR" "$TASKS_DIR"

EVENT_TEMPLATE="$TEMPLATES_DIR/event-template.md"
TASK_TEMPLATE="$TEMPLATES_DIR/task-template.md"

if [[ ! -f "$EVENT_TEMPLATE" ]]; then
  cat > "$EVENT_TEMPLATE" <<'EOF'
---
title: <% tp.file.title %>
date: <% tp.date.now("YYYY-MM-DD[T]09:00") %>
end: <% tp.date.now("YYYY-MM-DD[T]10:00") %>
timezone: Pacific/Auckland
location:
description:
status: confirmed
visibility: default
eventType: meeting
color:
guestsCanInviteOthers: true
guestsCanModify: false
guestsCanSeeOtherGuests: true
reminders:
  useDefault: false
  overrides:
    - method: popup
      minutes: 10
attendees:
  required:
    -
  optional:
    -
---

Notes:
-
EOF
fi

if [[ ! -f "$TASK_TEMPLATE" ]]; then
  cat > "$TASK_TEMPLATE" <<'EOF'
---
title: <% tp.file.title %>
due: <% tp.date.now("YYYY-MM-DD") %>
completed: false
---

Notes:
-
EOF
fi

README_OUT="$TEMPLATES_DIR/README.md"
cat > "$README_OUT" <<'EOF'
# Google Sync + Templater quick setup

Templates created by `scripts/setup-templater.sh`:

- Event template: `templates/google-sync/event-template.md`
- Task template: `templates/google-sync/task-template.md`

Suggested Templater settings:
- Template folder location: `templates`
- Trigger Templater on new file creation: enabled

Suggested Google Sync settings:
- Events folder: `events`
- Tasks folder: `tasks`
EOF

if $CONFIGURE; then
  TP_DATA="$VAULT_PATH/.obsidian/plugins/templater-obsidian/data.json"
  mkdir -p "$(dirname "$TP_DATA")"
  if [[ -f "$TP_DATA" ]]; then
    python3 - <<'PY' "$TP_DATA"
import json,sys
p=sys.argv[1]
with open(p,'r',encoding='utf-8') as f:
    data=json.load(f)
if not isinstance(data,dict):
    data={}
data['templates_folder']='templates'
data['trigger_on_file_creation']=True
with open(p,'w',encoding='utf-8') as f:
    json.dump(data,f,indent=2)
    f.write('\n')
print(f"Updated {p}")
PY
  else
    cat > "$TP_DATA" <<'EOF'
{
  "templates_folder": "templates",
  "trigger_on_file_creation": true
}
EOF
    echo "Created $TP_DATA"
  fi
fi

echo "Done. Created (if missing):"
echo "- $EVENT_TEMPLATE"
echo "- $TASK_TEMPLATE"
echo "- $README_OUT"
if $CONFIGURE; then
  echo "- Templater settings were updated"
fi
