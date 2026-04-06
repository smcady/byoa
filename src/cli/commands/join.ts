import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig } from '../config.js';

export async function join(input: string): Promise<void> {
  if (!input) {
    console.error('Usage: agora join <channelId:token>');
    console.error('Example: agora join chan_abc123:agora_tok_xyz...');
    process.exit(1);
  }

  // Parse input — expect channelId:token
  const colonIdx = input.indexOf(':agora_tok_');
  if (colonIdx === -1) {
    console.error('Expected format: <channelId>:<token>');
    console.error('Example: agora join chan_abc123:agora_tok_xyz...');
    process.exit(1);
  }

  const channelId = input.slice(0, colonIdx);
  const token = input.slice(colonIdx + 1);

  if (!channelId.startsWith('chan_') || !token.startsWith('agora_tok_')) {
    console.error('Invalid format. Channel ID should start with chan_ and token with agora_tok_');
    process.exit(1);
  }

  const config = loadConfig();
  const serverUrl = config.serverUrl;

  // Fetch channel name from server
  let channelName = channelId;
  try {
    const res = await fetch(`${serverUrl}/api/channels`);
    const body = (await res.json()) as {
      channels: Array<{ id: string; name: string }>;
    };
    const ch = body.channels.find((c) => c.id === channelId);
    if (ch) channelName = ch.name;
  } catch {
    // Server not reachable — use channel ID as name
  }

  const safeName = channelName.toLowerCase().replace(/\s+/g, '-');
  const mcpServerName = `agora-${safeName}`;
  const mcpEntry = {
    type: 'http',
    url: `${serverUrl}/mcp/${channelId}`,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  // Find the right settings file to write to
  const settingsPath = findClaudeSettingsPath();

  // Read existing settings or create new
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    // File doesn't exist or invalid JSON
  }

  // Merge MCP server config
  if (!settings.mcpServers || typeof settings.mcpServers !== 'object') {
    settings.mcpServers = {};
  }
  (settings.mcpServers as Record<string, unknown>)[mcpServerName] = mcpEntry;

  // Write
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  console.log(`\nJoined channel: ${channelName} (${channelId})`);
  console.log(`MCP server "${mcpServerName}" configured in:`);
  console.log(`  ${settingsPath}`);
  console.log(`\nRestart Claude Code to connect. Then run: whoami`);
  console.log();
}

function findClaudeSettingsPath(): string {
  // Look for a project .claude/ directory walking up from cwd
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const claudeDir = path.join(dir, '.claude');
    if (fs.existsSync(claudeDir) && fs.statSync(claudeDir).isDirectory()) {
      return path.join(claudeDir, 'settings.local.json');
    }
    dir = path.dirname(dir);
  }

  // Fall back to project-level in cwd
  return path.join(process.cwd(), '.claude', 'settings.local.json');
}
