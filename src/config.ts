import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: parseInt(process.env.AGORA_PORT ?? '3000', 10),
  host: process.env.AGORA_HOST ?? '0.0.0.0',
  dataDir: process.env.AGORA_DATA_DIR ?? path.resolve(__dirname, '..', 'data', 'channels'),
};
