import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: parseInt(process.env.PORT ?? process.env.BYOA_PORT ?? '3737', 10),
  host: process.env.BYOA_HOST ?? '0.0.0.0',
  dataDir: process.env.BYOA_DATA_DIR ?? path.resolve(__dirname, '..', 'data', 'channels'),
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    /** Comma-separated chatId:channelId pairs, e.g. "-100123:chan_abc,-100456:chan_def" */
    bindings: process.env.TELEGRAM_BINDINGS ?? '',
  },
};
