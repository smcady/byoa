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
  permissions TEXT NOT NULL DEFAULT '["messaging","files_read","files_write","memory_read","memory_write","participants"]',
  privacy_policy TEXT,
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

CREATE TABLE IF NOT EXISTS coordination_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  participant_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_coord_log_ts ON coordination_log(ts);
`;

const MIGRATIONS = [
  // Add permissions column if it doesn't exist (v0.2.0)
  `ALTER TABLE participants ADD COLUMN permissions TEXT NOT NULL DEFAULT '["messaging","files_read","files_write","memory_read","memory_write","participants"]'`,
  // Add privacy_policy column (v0.2.0)
  `ALTER TABLE participants ADD COLUMN privacy_policy TEXT`,
];

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

  /** Tracks which participants are currently composing (participantId -> displayName) */
  private composing = new Map<string, string>();

  constructor(channelId: string, dataDir: string) {
    super();
    this.channelId = channelId;
    const channelDir = path.join(dataDir, channelId);
    fs.mkdirSync(channelDir, { recursive: true });

    this.db = new BetterSqlite3(path.join(channelDir, 'channel.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.applyMigrations();

    this.messages = new MessageStore(this.db, channelId);
    this.memory = new MemoryStore(this.db, channelId);
    this.files = new FileStore(path.join(channelDir, 'files'));
    this.participants = new ParticipantStore(this.db, channelId);
  }

  /** Get the rowid of the most recent message, or 0 if none. */
  getLatestRowid(): number {
    const row = this.db.prepare('SELECT MAX(rowid) as maxRowid FROM messages').get() as { maxRowid: number | null };
    return row?.maxRowid ?? 0;
  }

  /** Get messages with rowid > afterRowid (for checkpoint diffing). */
  getMessagesSinceRowid(afterRowid: number, excludeParticipantId?: string): Message[] {
    let query = `SELECT m.*, p.display_name, p.type AS participant_type, p.agent_name
      FROM messages m LEFT JOIN participants p ON m.participant_id = p.id
      WHERE m.rowid > ?`;
    const params: unknown[] = [afterRowid];

    if (excludeParticipantId) {
      query += ` AND m.participant_id != ?`;
      params.push(excludeParticipantId);
    }

    query += ` ORDER BY m.rowid ASC LIMIT 50`;

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string; participant_id: string; type: string; content: string;
      metadata: string | null; created_at: string;
      display_name: string | null; participant_type: string | null; agent_name: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      channelId: this.channelId,
      participantId: r.participant_id,
      displayName: r.display_name ?? undefined,
      participantType: (r.participant_type as 'human' | 'agent') ?? undefined,
      agentName: r.agent_name ?? undefined,
      type: r.type as Message['type'],
      content: r.content,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.created_at,
    }));
  }

  /** Append a coordination event to the replay log. */
  logCoordination(participantId: string, displayName: string, event: string, detail?: string): void {
    this.db.prepare(
      'INSERT INTO coordination_log (participant_id, display_name, event, detail) VALUES (?, ?, ?, ?)'
    ).run(participantId, displayName, event, detail ?? null);
  }

  /** Read recent coordination events for replay review. */
  getCoordinationLog(limit = 100): Array<{ id: number; ts: string; displayName: string; event: string; detail?: string }> {
    const rows = this.db.prepare(
      'SELECT id, ts, display_name, event, detail FROM coordination_log ORDER BY id DESC LIMIT ?'
    ).all(limit) as Array<{ id: number; ts: string; display_name: string; event: string; detail: string | null }>;
    return rows.reverse().map((r) => ({
      id: r.id,
      ts: r.ts,
      displayName: r.display_name,
      event: r.event,
      detail: r.detail ?? undefined,
    }));
  }

  setComposing(participantId: string, displayName: string): void {
    this.composing.set(participantId, displayName);
  }

  clearComposing(participantId: string): void {
    this.composing.delete(participantId);
  }

  getComposing(excludeParticipantId?: string): string[] {
    const names: string[] = [];
    for (const [id, name] of this.composing) {
      if (id !== excludeParticipantId) names.push(name);
    }
    return names;
  }

  addMessage(
    participantId: string,
    content: string,
    type: Message['type'] = 'text',
    metadata?: Record<string, string>
  ): Message {
    // Sending a message clears composing state
    this.composing.delete(participantId);

    const msg = this.messages.add(participantId, content, type, metadata);
    // Enrich with participant identity for broadcast
    const participant = this.participants.getById(participantId);
    if (participant) {
      msg.displayName = participant.displayName;
      msg.participantType = participant.type;
      msg.agentName = participant.agentName;
    }
    this.emit('message:new', msg);
    return msg;
  }

  private applyMigrations(): void {
    for (const migration of MIGRATIONS) {
      try {
        this.db.exec(migration);
      } catch {
        // Column/table already exists — skip
      }
    }
  }

  close(): void {
    this.db.close();
  }
}
