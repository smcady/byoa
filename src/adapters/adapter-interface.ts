import type { ChannelStore } from '../channel/channel-store.js';

export interface PlatformAdapter {
  readonly platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AdapterBinding {
  channelId: string;
  store: ChannelStore;
  platformConfig: Record<string, unknown>;
}
