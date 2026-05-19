#!/usr/bin/env bash
# Convenience wrapper for the docker compose quickstart's RBAC demo.
#
# Sends an MCP `tools/call` to the running gateway over stdio (via `docker exec`),
# with a `tools/list` first so the gateway has time to register backends before
# the call lands. The MCP SDK dispatches incoming JSON-RPC messages
# concurrently, so without the list-first dance the call can race past the
# in-flight backend registration. Real AI clients (Claude Desktop etc.) always
# list before calling, so they never hit this in practice — this script just
# mimics that ordering for shell-driven demos.
#
# Usage:
#   docker/demo-call.sh <tool_name> <json_arguments> [email]
#
# Examples:
#   docker/demo-call.sh demo_search '{"query":"hello"}'
#   docker/demo-call.sh demo_create '{"name":"widget"}' viewer@example.com

# `set -e` is intentionally omitted: `timeout 25` returns 124 every successful
# run (the gateway is a long-lived stdio server and never exits on its own).
# We rely on the grep + python parse to surface real failures via empty output.
set -uo pipefail

TOOL="${1:?usage: demo-call.sh <tool> <json_args> [email]}"
ARGS="${2:?usage: demo-call.sh <tool> <json_args> [email]}"
EMAIL="${3:-}"

CONTAINER="mcp-gateway-quickstart"

EXEC_ARGS=(-i)
if [[ -n "$EMAIL" ]]; then
  EXEC_ARGS+=(-e "GATEWAY_USER_EMAIL=$EMAIL")
fi

{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo-call","version":"1"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  # Let backendsReady resolve before the call lands. 6s is comfortable; the
  # initial backend connect typically completes in 1–2s.
  sleep 6
  printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":$ARGS}}"
  sleep 2
} | timeout 25 docker exec "${EXEC_ARGS[@]}" "$CONTAINER" \
    pnpm exec tsx src/index.ts serve --config docker/gateway.config.docker.json 2>/dev/null \
  | grep '"id":3' \
  | python3 -c 'import json,sys; r=json.loads(sys.stdin.read()); print(r["result"]["content"][0]["text"])'

# Always exit 0; the pipeline's exit code is dominated by `timeout 25` which
# always fires (see set -e comment above).
exit 0
