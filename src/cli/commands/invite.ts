import { ApiClient } from '../api-client.js';
import { loadConfig, saveConfig, getCurrentChannel } from '../config.js';
import { encodeJoinString } from '../join-string.js';

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

  // Generate join string
  const joinString = encodeJoinString(config.serverUrl, channelId, result.token);

  console.log(`\nInvited: ${result.participant.displayName} (${result.participant.type})`);
  console.log(`Token:   ${result.token}`);

  console.log(`\n── Send this to your colleague ──\n`);
  console.log(`  npx agora join ${joinString}`);
  console.log(`\nThat single command configures their Claude Code to connect.`);
  console.log(`They just need to restart Claude Code afterward.\n`);
}
