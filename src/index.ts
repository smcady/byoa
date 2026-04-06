import { config } from './config.js';
import { ChannelManager } from './channel/channel-manager.js';
import { createApp } from './server/http-server.js';
import { TelegramAdapter } from './adapters/telegram/telegram-adapter.js';
import type { TelegramBinding } from './adapters/telegram/telegram-adapter.js';
import { installLogBuffer, getLogLines } from './log-buffer.js';

installLogBuffer();

const channelManager = new ChannelManager(config.dataDir);
const { app, sessionManager } = createApp(channelManager);

let telegramAdapter: TelegramAdapter | undefined;

const server = app.listen(config.port, config.host, async () => {
  console.log(`Agora server running on http://${config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);

  // Start Telegram adapter if configured
  if (config.telegram.botToken && config.telegram.bindings) {
    const bindings: TelegramBinding[] = config.telegram.bindings
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const [chatId, channelId] = pair.split(':');
        return { chatId: parseInt(chatId, 10), channelId };
      });

    if (bindings.length > 0) {
      telegramAdapter = new TelegramAdapter(
        { botToken: config.telegram.botToken, bindings },
        channelManager
      );
      await telegramAdapter.start();
    }
  }

  if (!telegramAdapter) {
    console.log();
    console.log('Quick start:');
    console.log(`  curl -X POST http://localhost:${config.port}/api/channels -H "Content-Type: application/json" -d '{"name":"my-project"}'`);
    console.log();
    console.log('Telegram: set TELEGRAM_BOT_TOKEN and TELEGRAM_BINDINGS to enable');
  }

  // Remote log viewer
  app.get('/api/logs', (req, res) => {
    const filter = req.query.filter as string | undefined;
    res.type('text/plain').send(getLogLines(filter).join('\n'));
  });

  // Expose Telegram stats via the diagnostics endpoint
  app.get('/api/diagnostics/telegram', (_req, res) => {
    if (!telegramAdapter) {
      res.json({ enabled: false });
      return;
    }
    res.json({ enabled: true, ...telegramAdapter.getStats() });
  });
});

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (telegramAdapter) await telegramAdapter.stop();
  sessionManager.closeAll();
  channelManager.closeAll();
  server.close();
  process.exit(0);
});
