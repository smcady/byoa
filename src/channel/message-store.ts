import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { Message } from '../types/channel.js';

export class MessageStore {
  constructor(
    private db: Database.Database,
    private channelId: string
  ) {}

  add(
    participantId: string,
    content: string,
    type: Message['type'] = 'text',
    metadata?: Record<string, string>
  ): Message {
    const msg: Message = {
      id: nanoid(),
      channelId: this.channelId,
      participantId,
      type,
      content,
      metadata,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO messages (id, participant_id, type, content, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        msg.id,
        msg.participantId,
        msg.type,
        msg.content,
        metadata ? JSON.stringify(metadata) : null,
        msg.createdAt
      );
    return msg;
  }

  list(opts: { limit?: number; before?: string; after?: string } = {}): Message[] {
    const limit = Math.min(opts.limit ?? 50, 200);
    let query: string;
    const params: unknown[] = [];

    if (opts.before) {
      // before = message ID — get messages with lower rowid
      query = `SELECT * FROM messages WHERE rowid < (SELECT rowid FROM messages WHERE id = ?) ORDER BY rowid DESC LIMIT ?`;
      params.push(opts.before, limit);
    } else if (opts.after) {
      // after = message ID — get messages with higher rowid
      query = `SELECT * FROM messages WHERE rowid > (SELECT rowid FROM messages WHERE id = ?) ORDER BY rowid ASC LIMIT ?`;
      params.push(opts.after, limit);
    } else {
      query = `SELECT * FROM messages ORDER BY rowid DESC LIMIT ?`;
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      participant_id: string;
      type: string;
      content: string;
      metadata: string | null;
      created_at: string;
    }>;

    const messages = rows.map((r) => this.rowToMessage(r));

    // For "before" and default (no cursor), results come DESC — reverse to chronological
    if (!opts.after) messages.reverse();

    return messages;
  }

  getById(id: string): Message | undefined {
    const row = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as
      | { id: string; participant_id: string; type: string; content: string; metadata: string | null; created_at: string }
      | undefined;
    return row ? this.rowToMessage(row) : undefined;
  }

  private rowToMessage(r: {
    id: string;
    participant_id: string;
    type: string;
    content: string;
    metadata: string | null;
    created_at: string;
  }): Message {
    return {
      id: r.id,
      channelId: this.channelId,
      participantId: r.participant_id,
      type: r.type as Message['type'],
      content: r.content,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.created_at,
    };
  }
}
