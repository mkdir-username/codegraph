#!/usr/bin/env bash
# Tool-surface ablation — run ONE repo+question under ONE arm.
#
# Arms vary (exposed codegraph tools, trace-first steering). Tools are trimmed
# SERVER-SIDE via CODEGRAPH_MCP_TOOLS in the MCP config's `env` block, so an
# ablated tool is genuinely absent from ListTools — no deferred-ToolSearch or
# denied-call confound (which --disallowedTools would introduce). Steering is
# injected with --append-system-prompt, so no rebuild of the shipped
# server-instructions is needed to A/B it.
#
#   A control       all tools            no steering
#   B steer         all tools            trace-first
#   C no-explore    hide explore         trace-first
#   D trace-centric hide explore+context trace-first
#   E control-probe hide explore+context trace-first  (caller passes a NON-flow Q)
#   J explore-only  hide all but explore no steering   (upstream's DEFAULT_MCP_TOOLS bet)
#
# Usage: run-arms.sh <repo-path> "<question>" <A|B|C|D|E|J> [run-id]
set -uo pipefail
REPO="${1:?repo path}"; Q="${2:?question}"; ARM="${3:?arm A-J}"; RID="${4:-1}"
CG_BIN="${CG_BIN:-$(command -v codegraph)}"
OUT="${ARMS_OUT:-/tmp/arms}/$(basename "$REPO")"
mkdir -p "$OUT"
[ -n "$CG_BIN" ] || { echo "no codegraph binary (set CG_BIN)"; exit 1; }
[ -d "$REPO/.codegraph" ] || { echo "no .codegraph index at $REPO"; exit 1; }

STEER='Flow questions ("how does X reach/become Y", "trace the flow", request to handler, state to render): call codegraph_trace(from,to) FIRST — one call returns the whole path. Use codegraph_context/search only to locate the two endpoint symbols if you do not know them. Do NOT reconstruct the path with repeated search/callers/explore.'
KEEP_NO_EXPLORE="trace,search,node,context,callers,callees,impact,files,status"
KEEP_TRACE_CENTRIC="trace,search,node,callers,callees,impact,files,status"
KEEP_EXPLORE_ONLY="explore"

case "$ARM" in
  A|G|H|I) TOOLS="";            STEERING="" ;;  # no steering; H = body-trace, I = body-trace + destination callees (sufficiency)
  B|F) TOOLS="";                STEERING="$STEER" ;;  # F = B's surface, run on the body-inlining trace build
  C) TOOLS="$KEEP_NO_EXPLORE";  STEERING="$STEER" ;;
  D|E) TOOLS="$KEEP_TRACE_CENTRIC"; STEERING="$STEER" ;;
  J) TOOLS="$KEEP_EXPLORE_ONLY"; STEERING="" ;;  # compares head-to-head with A
  *) echo "bad arm '$ARM' (want A|B|C|D|E|J)"; exit 1 ;;
esac

# CODEGRAPH_NO_DAEMON is not optional here: with a daemon alive, `serve --mcp`
# degrades to a proxy and ListTools is computed inside the daemon, with the env
# of ITS first start — the allowlist is then silently ignored and every arm gets
# the full surface. Set on BOTH arms so the daemon is never the variable.
CFG="$OUT/mcp-$ARM.json"
if [ -n "$TOOLS" ]; then
  cat > "$CFG" <<JSON
{"mcpServers":{"codegraph":{"command":"$CG_BIN","args":["serve","--mcp","--path","$REPO"],"env":{"CODEGRAPH_MCP_TOOLS":"$TOOLS","CODEGRAPH_NO_DAEMON":"1"}}}}
JSON
else
  cat > "$CFG" <<JSON
{"mcpServers":{"codegraph":{"command":"$CG_BIN","args":["serve","--mcp","--path","$REPO"],"env":{"CODEGRAPH_NO_DAEMON":"1"}}}}
JSON
fi

LOG="$OUT/$ARM-r$RID.jsonl"; ERR="$OUT/$ARM-r$RID.err"
ARGS=( -p "$Q" --output-format stream-json --verbose
       --permission-mode bypassPermissions --model opus --max-budget-usd 4
       --strict-mcp-config --mcp-config "$CFG" )
[ -n "$STEERING" ] && ARGS+=( --append-system-prompt "$STEERING" )

( cd "$REPO" && claude "${ARGS[@]}" > "$LOG" 2>"$ERR" )
echo "[$(basename "$REPO") $ARM r$RID] exit $? -> $LOG ($(wc -l < "$LOG" | tr -d ' ') lines)"
