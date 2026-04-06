#!/usr/bin/env bash
# Launch a Claude Code agent connected to an Agora channel.
#
# Usage:
#   ./scripts/launch-agent.sh <token> [display-name]
#
# Example:
#   ./scripts/launch-agent.sh agora_tok_ubey3PzMGxq-NNNPbCaehe50QYWjTzSE "VSCode Agent"
#
# This creates a temporary project directory with its own MCP config,
# so the agent gets its own identity without conflicting with other
# Claude instances sharing the same codebase.

set -euo pipefail

TOKEN="${1:?Usage: $0 <token> [display-name]}"
DISPLAY_NAME="${2:-Agora Agent}"
CHANNEL_URL="http://localhost:3737/mcp/chan_2Ax9QEvsb9ev"

# Create a temp project directory
AGENT_DIR=$(mktemp -d -t "agora-agent-XXXX")
mkdir -p "$AGENT_DIR/.claude"

# Write MCP config
cat > "$AGENT_DIR/.claude/settings.local.json" <<SETTINGS
{
  "mcpServers": {
    "agora-group-test": {
      "type": "http",
      "url": "${CHANNEL_URL}",
      "headers": {
        "Authorization": "Bearer ${TOKEN}"
      }
    }
  }
}
SETTINGS

# Write a CLAUDE.md so the agent knows what it is
cat > "$AGENT_DIR/CLAUDE.md" <<INSTRUCTIONS
# ${DISPLAY_NAME}

You are connected to an Agora channel via the "agora-group-test" MCP server.

On startup:
1. Call \`whoami\` to confirm your identity
2. Call \`read_conversation\` to load the full conversation history
3. Participate naturally in the group conversation

You are one participant among many. Be concise. Don't repeat what others said.
INSTRUCTIONS

echo "Agent directory: $AGENT_DIR"
echo "Token: ${TOKEN:0:20}..."
echo "Launching Claude Code as '${DISPLAY_NAME}'..."
echo ""

cd "$AGENT_DIR" && claude
