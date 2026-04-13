#!/usr/bin/env bash
# Launch a Claude Code agent connected to a BYOA channel.
#
# Usage:
#   ./scripts/launch-agent.sh <mcp-url> <token> [display-name]
#
# Examples:
#   ./scripts/launch-agent.sh https://your-server.example.com/mcp/chan_abc123 byoa_tok_xyz "My Agent"
#   ./scripts/launch-agent.sh http://localhost:3737/mcp/chan_abc123 byoa_tok_xyz "Local Agent"

set -euo pipefail

MCP_URL="${1:?Usage: $0 <mcp-url> <token> [display-name]}"
TOKEN="${2:?Usage: $0 <mcp-url> <token> [display-name]}"
DISPLAY_NAME="${3:-BYOA Agent}"

# Ensure Claude is authenticated before launching — login swallows the initial
# prompt, which prevents the agent from auto-entering its wait loop.
if ! claude auth status &>/dev/null; then
  echo "Claude is not logged in. Logging in now..."
  claude auth login
  echo ""
fi

# Create a temp project directory
AGENT_DIR=$(mktemp -d -t "byoa-agent-XXXX")

# Write a CLAUDE.md so the agent knows what it is
cat > "$AGENT_DIR/CLAUDE.md" <<INSTRUCTIONS
# ${DISPLAY_NAME}

You are connected to a BYOA channel via the "byoa" MCP server.

## On startup (do this immediately, without being asked)

1. Call \`whoami\` to confirm your identity
2. Call \`read_conversation\` to load the full conversation history
3. Respond to anything that needs a response via \`send_message\`
4. Call \`wait_for_messages\` to listen for new messages
5. When messages arrive, respond if appropriate via \`send_message\`, then call \`wait_for_messages\` again
6. Stay in this wait → respond → wait loop indefinitely

You are one participant among many. Be concise. Don't repeat what others said.
INSTRUCTIONS

echo "Agent directory: $AGENT_DIR"
echo "URL: $MCP_URL"
echo "Token: ${TOKEN:0:20}..."
echo ""

# Register MCP server and SessionStart hook scoped to this temp project directory
cd "$AGENT_DIR"
mkdir -p .claude

claude mcp add byoa \
  --transport http \
  "$MCP_URL" \
  --header "Authorization: Bearer ${TOKEN}"

# SessionStart hook — fires after auth, injects instructions as context.
# This is more reliable than the initial prompt, which gets swallowed by /login.
cat > .claude/settings.local.json <<SETTINGS
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'You are ${DISPLAY_NAME}. Follow your CLAUDE.md instructions immediately: call whoami, read_conversation, respond if needed, then enter a wait_for_messages loop. Start now.'"
          }
        ]
      }
    ]
  }
}
SETTINGS

echo ""
echo "Launching Claude Code as '${DISPLAY_NAME}'..."
echo ""

# Launch with a simple prompt — the auth pre-check above ensures login won't
# swallow it. The SessionStart hook serves as a fallback for resume scenarios.
claude "start"
