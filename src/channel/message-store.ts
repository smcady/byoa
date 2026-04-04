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
    const select = `SELECT m.*, p.display_name, p.type AS participant_type, p.agent_name
      FROM messages m LEFT JOIN participants p ON m.participant_id = p.id`;
    let query: string;
    const params: unknown[] = [];

    if (opts.before) {
      query = `${select} WHERE m.rowid < (SELECT rowid FROM messages WHERE id = ?) ORDER BY m.rowid DESC LIMIT ?`;
      params.push(opts.before, limit);
    } else if (opts.after) {
      query = `${select} WHERE m.rowid > (SELECT rowid FROM messages WHERE id = ?) ORDER BY m.rowid ASC LIMIT ?`;
      params.push(opts.after, limit);
    } else {
      query = `${select} ORDER BY m.rowid DESC LIMIT ?`;
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as RichRow[];
    const messages = rows.map((r) => this.rowToMessage(r));
    if (!opts.after) messages.reverse();
    return messages;
  }

  listFormatted(opts: { limit?: number; before?: string; after?: string } = {}): string {
    const messages = this.list(opts);
    if (messages.length === 0) return '(no messages yet)';
    return messages
      .map((m) => {
        const name = m.displayName ?? m.participantId;
        const role = m.participantType ?? 'unknown';
        const label = m.agentName ? `${name} [${role}, ${m.agentName}]` : `${name} [${role}]`;
        return `[${label}] ${m.content}`;
      })
      .join('\n\n');
  }

  getById(id: string): Message | undefined {
    const row = this.db
      .prepare(
        `SELECT m.*, p.display_name, p.type AS participant_type, p.agent_name
         FROM messages m LEFT JOIN participants p ON m.participant_id = p.id
         WHERE m.id = ?`
      )
      .get(id) as RichRow | undefined;
    return row ? this.rowToMessage(row) : undefined;
  }

  private rowToMessage(r: RichRow): Message {
    return {
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
    };
  }
}

type RichRow = {
  id: string;
  participant_id: string;
  type: string;
  content: string;
  metadata: string | null;
  created_at: string;
  display_name: string | null;
  participant_type: string | null;
  agent_name: string | null;
};
