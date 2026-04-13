import { ApiClient } from '../api-client.js';
import { loadConfig, getCurrentChannel } from '../config.js';

export async function status(channelId?: string): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config.serverUrl);

  const targetId = channelId ?? config.currentChannel;
  if (!targetId) {
    console.error('No active channel. Run: byoa channel create <name>');
    process.exit(1);
  }

  const creds = config.channels[targetId];
  const token = creds?.adminToken;

  if (!token) {
    console.error(`No admin token for channel ${targetId}`);
    process.exit(1);
  }

  // Get participants
  const result = (await api.get(
    `/api/channels/${targetId}/participants`,
    token
  )) as {
    participants: Array<{
      id: string;
      displayName: string;
      type: string;
      agentName?: string;
      joinedAt: string;
      lastSeenAt: string;
    }>;
  };

  console.log(`\nChannel: ${creds.name} (${targetId})`);
  console.log(`Server:  ${config.serverUrl}`);
  console.log(`\nParticipants (${result.participants.length}):\n`);

  for (const p of result.participants) {
    const role = p.agentName ? `${p.type}, ${p.agentName}` : p.type;
    const seen = timeSince(p.lastSeenAt);
    console.log(`  ${p.displayName} [${role}] — last seen ${seen}`);
  }
  console.log();
}

function timeSince(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
