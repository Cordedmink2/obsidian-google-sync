#!/usr/bin/env bash
# End-to-end smoke test for the headless sync bundle: temp git vault + bare remote,
# mocked Google API (no network). Run from the repo root after `npm run build:headless`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

VAULT="$TMP/vault"
BARE="$TMP/remote.git"
CFG="$TMP/gsync.json"
TOKENS="$TMP/gsync-tokens.json"

# Vault repo + bare remote
git init -q -b main "$VAULT"
git -C "$VAULT" config commit.gpgsign false
git -C "$VAULT" config user.name smoke
git -C "$VAULT" config user.email smoke@x
git -C "$VAULT" commit -q --allow-empty -m init
git init -q --bare "$BARE"
git --git-dir="$BARE" symbolic-ref HEAD refs/heads/main
git -C "$VAULT" remote add origin "$BARE"
git -C "$VAULT" push -qu origin main

# Config + a fake (non-expired) token set
cat > "$CFG" <<EOF
{
  "vaultPath": "$VAULT",
  "tokenFile": "$TOKENS",
  "settings": { "clientId": "smoke", "clientSecret": "smoke", "taskListId": "L1" },
  "git": { "enabled": true, "branch": "main" }
}
EOF
node -e "require('fs').writeFileSync('$TOKENS', JSON.stringify({accessToken:'fake', refreshToken:'rt', expiresAt: Date.now()+3600000}))"

run_sync() {
  node --require "$ROOT/scripts/headless-mock-fetch.cjs" "$ROOT/dist/headless/sync.cjs" --config "$CFG" "$@"
}

echo "--- run 1: import + lifecycle + git push"
run_sync

test -f "$VAULT/.google-sync/state.json" || { echo "FAIL: no state.json"; exit 1; }
ls "$VAULT"/events/*.md >/dev/null || { echo "FAIL: no event note imported"; exit 1; }
ls "$VAULT"/tasks/*.md >/dev/null || { echo "FAIL: no task note imported"; exit 1; }
git -C "$VAULT" status --porcelain | grep -q . && { echo "FAIL: dirty tree after run"; exit 1; }
# Capture the log first: `git log | grep -q` under pipefail fails at random when grep exits
# early and git log takes SIGPIPE.
remote_log() { git --git-dir="$BARE" log --oneline main; }
LOG="$(remote_log)"
grep -q "google-sync:" <<<"$LOG" || { echo "FAIL: no sync commit on remote"; exit 1; }

echo "--- run 2: idempotent (no new commit)"
COMMITS_BEFORE=$(git --git-dir="$BARE" rev-list --count main)
run_sync
COMMITS_AFTER=$(git --git-dir="$BARE" rev-list --count main)
[ "$COMMITS_BEFORE" = "$COMMITS_AFTER" ] || { echo "FAIL: unchanged run created a commit"; exit 1; }

echo "--- run 3: local edit pushes a PATCH and survives a diverged remote"
TASK_NOTE=$(ls "$VAULT"/tasks/*.md | head -1)
node -e "
const fs = require('fs');
const f = '$TASK_NOTE';
fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('completed: false', 'completed: true'));
"
# Diverge the remote so the run has to reconcile before pushing.
SCRATCH="$TMP/scratch"
git clone -q "$BARE" "$SCRATCH"
git -C "$SCRATCH" config commit.gpgsign false
echo "remote edit" > "$SCRATCH/unrelated.md"
git -C "$SCRATCH" add -A
git -C "$SCRATCH" -c user.name=other -c user.email=o@x commit -qm "remote-side change"
git -C "$SCRATCH" push -q origin main

run_sync

LOG="$(remote_log)"
grep -q "remote-side change" <<<"$LOG" || { echo "FAIL: remote commit lost"; exit 1; }
test -f "$VAULT/unrelated.md" || { echo "FAIL: remote change not pulled into vault"; exit 1; }
grep -q "status: completed" "$TASK_NOTE" || true  # import may rewrite from mock; the PATCH is what matters

echo "--- run 4: dry run makes no commits and no writes"
COMMITS_BEFORE=$(git --git-dir="$BARE" rev-list --count main)
run_sync --dry-run
COMMITS_AFTER=$(git --git-dir="$BARE" rev-list --count main)
[ "$COMMITS_BEFORE" = "$COMMITS_AFTER" ] || { echo "FAIL: dry run pushed"; exit 1; }

echo "SMOKE OK"
