import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { MessageStore } from './message-store.js';
import { MemoryStore } from './memory-store.js';
import { FileStore } from './file-store.js';
import { ParticipantStore } from './participant-store.js';
import type { Message } from '../types/channel.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channel_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('human', 'agent')),
  agent_name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS memory (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  set_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS read_cursors (
  participant_id TEXT PRIMARY KEY,
  last_read_rowid INTEGER NOT NULL DEFAULT 0
);
`;

export interface ChannelStoreEvents {
  'message:new': (message: Message) => void;
}

export class ChannelStore extends EventEmitter {
  readonly channelId: string;
  readonly messages: MessageStore;
  readonly memory: MemoryStore;
  readonly files: FileStore;
  readonly participants: ParticipantStore;
  private db: Database.Database;

  constructor(channelId: string, dataDir: string) {
    super();
    this.channelId = channelId;
    const channelDir = path.join(dataDir, channelId);
    fs.mkdirSync(channelDir, { recursive: true });

    this.db = new BetterSqlite3(path.join(channelDir, 'channel.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);

    this.messages = new MessageStore(this.db, channelId);
    this.memory = new MemoryStore(this.db, channelId);
    this.files = new FileStore(path.join(channelDir, 'files'));
    this.participants = new ParticipantStore(this.db, channelId);
  }

  addMessage(
    participantId: string,
    content: string,
    type: Message['type'] = 'text',
    metadata?: Record<string, string>
  ): Message {
    const msg = this.messages.add(participantId, content, type, metadata);
    this.emit('message:new', msg);
    return msg;
  }

  close(): void {
    this.db.close();
  }
}
