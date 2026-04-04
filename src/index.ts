import { config } from './config.js';
import { ChannelManager } from './channel/channel-manager.js';
import { createApp } from './server/http-server.js';

const channelManager = new ChannelManager(config.dataDir);
const { app, sessionManager } = createApp(channelManager);

const server = app.listen(config.port, config.host, () => {
  console.log(`Agora server running on http://${config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  console.log();
  console.log('Quick start:');
  console.log(`  curl -X POST http://localhost:${config.port}/api/channels -H "Content-Type: application/json" -d '{"name":"my-project"}'`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  sessionManager.closeAll();
  channelManager.closeAll();
  server.close();
  process.exit(0);
});
