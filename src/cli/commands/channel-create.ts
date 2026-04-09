import { ApiClient } from '../api-client.js';
import { loadConfig, saveConfig, getAdminKey } from '../config.js';

export async function channelCreate(name: string): Promise<void> {
  if (!name) {
    console.error('Usage: agora channel create <name>');
    process.exit(1);
  }

  const config = loadConfig();
  const adminKey = getAdminKey(config);
  const api = new ApiClient(config.serverUrl);

  const result = (await api.post('/api/channels', { name }, adminKey)) as {
    channel: { id: string; name: string };
    adminToken: string;
    mcpEndpoint: string;
  };

  config.channels[result.channel.id] = {
    name: result.channel.name,
    adminToken: result.adminToken,
    tokens: {},
  };
  config.currentChannel = result.channel.id;
  saveConfig(config);

  console.log(`\nChannel created!`);
  console.log(`  ID:       ${result.channel.id}`);
  console.log(`  Name:     ${result.channel.name}`);
  console.log(`  Endpoint: ${config.serverUrl}${result.mcpEndpoint}`);
  console.log(`\nAdmin token saved. This is now your active channel.`);
  console.log(`\nNext: invite participants with:`);
  console.log(`  agora invite "Alice" --type agent --agent-name claude-code`);
}
