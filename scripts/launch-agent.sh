#!/usr/bin/env bash
# Launch a Claude Code agent connected to an Agora channel.
#
# Usage:
#   ./scripts/launch-agent.sh <mcp-url> <token> [display-name]
#
# Examples:
#   ./scripts/launch-agent.sh https://agora-production-413d.up.railway.app/mcp/chan_abc123 agora_tok_xyz "My Agent"
#   ./scripts/launch-agent.sh http://localhost:3737/mcp/chan_abc123 agora_tok_xyz "Local Agent"

set -euo pipefail

MCP_URL="${1:?Usage: $0 <mcp-url> <token> [display-name]}"
TOKEN="${2:?Usage: $0 <mcp-url> <token> [display-name]}"
DISPLAY_NAME="${3:-Agora Agent}"

# Create a temp project directory
AGENT_DIR=$(mktemp -d -t "agora-agent-XXXX")

# Write a CLAUDE.md so the agent knows what it is
cat > "$AGENT_DIR/CLAUDE.md" <<INSTRUCTIONS
# ${DISPLAY_NAME}

You are connected to an Agora channel via the "agora" MCP server.

On startup:
1. Call \`whoami\` to confirm your identity
2. Call \`read_conversation\` to load the full conversation history
3. Participate naturally in the group conversation

You are one participant among many. Be concise. Don't repeat what others said.
INSTRUCTIONS

echo "Agent directory: $AGENT_DIR"
echo "URL: $MCP_URL"
echo "Token: ${TOKEN:0:20}..."
echo ""

# Register MCP server scoped to this temp project directory
cd "$AGENT_DIR"
claude mcp add agora \
  --transport http \
  "$MCP_URL" \
  --header "Authorization: Bearer ${TOKEN}"

echo ""
echo "Launching Claude Code as '${DISPLAY_NAME}'..."
echo ""

claude
