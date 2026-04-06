import { ApiClient } from '../api-client.js';
import { loadConfig, saveConfig, getCurrentChannel } from '../config.js';

interface InviteOpts {
  displayName: string;
  type: string;
  agentName?: string;
  channelId?: string;
}

export async function invite(opts: InviteOpts): Promise<void> {
  if (!opts.displayName) {
    console.error('Usage: agora invite <display-name> [--type agent] [--agent-name claude-code]');
    process.exit(1);
  }

  const config = loadConfig();
  const api = new ApiClient(config.serverUrl);

  const channelId = opts.channelId ?? config.currentChannel;
  if (!channelId) {
    console.error('No active channel. Run: agora channel create <name>');
    process.exit(1);
  }

  const creds = config.channels[channelId];
  if (!creds) {
    console.error(`No admin token for channel ${channelId}. You need admin access to invite.`);
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    userId: opts.displayName.toLowerCase().replace(/\s+/g, '-'),
    displayName: opts.displayName,
    type: opts.type,
  };
  if (opts.agentName) body.agentName = opts.agentName;

  const result = (await api.post(
    `/api/channels/${channelId}/invite`,
    body,
    creds.adminToken
  )) as {
    participant: { id: string; displayName: string; type: string; agentName?: string };
    token: string;
    mcpConfig: { url: string };
  };

  // Save token
  creds.tokens[opts.displayName] = result.token;
  saveConfig(config);

  const channelName = creds.name.toLowerCase().replace(/\s+/g, '-');

  console.log(`\nInvited: ${result.participant.displayName} (${result.participant.type})`);
  console.log(`Token:   ${result.token}`);

  if (opts.type === 'agent') {
    console.log(`\n── MCP config (paste into Claude Code settings) ──\n`);
    const mcpConfig = {
      [`agora-${channelName}`]: {
        type: 'http',
        url: `${config.serverUrl}/mcp/${channelId}`,
        headers: {
          Authorization: `Bearer ${result.token}`,
        },
      },
    };
    console.log(JSON.stringify(mcpConfig, null, 2));

    console.log(`\n── Or join automatically ──\n`);
    console.log(`  agora join ${channelId}:${result.token}`);
  } else {
    console.log(`\nThis human can chat via Telegram (if bridge is configured).`);
    console.log(`Or join as an MCP participant: agora join ${channelId}:${result.token}`);
  }
  console.log();
}
