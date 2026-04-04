import path from 'node:path';
import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { ChannelStore } from './channel-store.js';
import { NotFoundError } from '../types/errors.js';
import type { Channel } from '../types/channel.js';

export class ChannelManager {
  private stores = new Map<string, ChannelStore>();

  constructor(private dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  create(name: string, createdBy: string): { channel: Channel; store: ChannelStore } {
    const id = `chan_${nanoid(12)}`;
    const store = new ChannelStore(id, this.dataDir);
    const channel: Channel = {
      id,
      name,
      createdAt: new Date().toISOString(),
      createdBy,
    };

    // Write meta to the channel's DB
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare(
      `INSERT INTO channel_meta (id, name, created_at, created_by) VALUES (?, ?, ?, ?)`
    ).run(channel.id, channel.name, channel.createdAt, channel.createdBy);

    this.stores.set(id, store);
    return { channel, store };
  }

  getOrLoad(channelId: string): ChannelStore {
    let store = this.stores.get(channelId);
    if (store) return store;

    const channelDir = path.join(this.dataDir, channelId);
    if (!fs.existsSync(path.join(channelDir, 'channel.db'))) {
      throw new NotFoundError(`Channel: ${channelId}`);
    }

    store = new ChannelStore(channelId, this.dataDir);
    this.stores.set(channelId, store);
    return store;
  }

  list(): Channel[] {
    const channels: Channel[] = [];
    if (!fs.existsSync(this.dataDir)) return channels;

    for (const entry of fs.readdirSync(this.dataDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('chan_')) continue;
      try {
        const store = this.getOrLoad(entry.name);
        const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
        const row = db.prepare(`SELECT * FROM channel_meta LIMIT 1`).get() as
          | { id: string; name: string; created_at: string; created_by: string }
          | undefined;
        if (row) {
          channels.push({
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            createdBy: row.created_by,
          });
        }
      } catch {
        // skip broken channel dirs
      }
    }
    return channels;
  }

  closeAll(): void {
    for (const store of this.stores.values()) {
      store.close();
    }
    this.stores.clear();
  }
}
