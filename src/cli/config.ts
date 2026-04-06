import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ChannelCredentials {
  name: string;
  adminToken: string;
  tokens: Record<string, string>; // participantName -> token
}

export interface AgoraCliConfig {
  serverUrl: string;
  currentChannel: string | null;
  channels: Record<string, ChannelCredentials>;
}

const CONFIG_DIR = path.join(os.homedir(), '.agora');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AgoraCliConfig = {
  serverUrl: `http://localhost:${process.env.AGORA_PORT ?? '3737'}`,
  currentChannel: null,
  channels: {},
};

export function loadConfig(): AgoraCliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AgoraCliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function getCurrentChannel(config: AgoraCliConfig): {
  id: string;
  name: string;
  adminToken: string;
} | null {
  if (!config.currentChannel) return null;
  const creds = config.channels[config.currentChannel];
  if (!creds) return null;
  return { id: config.currentChannel, name: creds.name, adminToken: creds.adminToken };
}
