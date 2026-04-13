import { ApiClient } from '../api-client.js';
import { loadConfig, getAdminKey } from '../config.js';

export async function channelList(): Promise<void> {
  const config = loadConfig();
  const adminKey = getAdminKey(config);
  const api = new ApiClient(config.serverUrl);

  const result = (await api.get('/api/channels', adminKey)) as {
    channels: Array<{ id: string; name: string; createdAt: string }>;
  };

  if (result.channels.length === 0) {
    console.log('No channels. Create one with: byoa channel create <name>');
    return;
  }

  console.log('\nChannels:\n');
  for (const ch of result.channels) {
    const current = ch.id === config.currentChannel ? ' ← active' : '';
    const hasToken = config.channels[ch.id] ? ' (token saved)' : '';
    console.log(`  ${ch.id}  ${ch.name}${hasToken}${current}`);
  }
  console.log();
}
