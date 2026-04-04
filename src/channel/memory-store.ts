import type Database from 'better-sqlite3';
import type { MemoryEntry } from '../types/channel.js';

export class MemoryStore {
  constructor(
    private db: Database.Database,
    private channelId: string
  ) {}

  get(key: string): MemoryEntry | undefined {
    const row = this.db.prepare(`SELECT * FROM memory WHERE key = ?`).get(key) as
      | { key: string; value: string; set_by: string; updated_at: string }
      | undefined;
    return row ? this.rowToEntry(row) : undefined;
  }

  set(key: string, value: string, setBy: string): MemoryEntry {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO memory (key, value, set_by, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, set_by = excluded.set_by, updated_at = excluded.updated_at`
      )
      .run(key, value, setBy, updatedAt);
    return { channelId: this.channelId, key, value, setBy, updatedAt };
  }

  list(prefix?: string): MemoryEntry[] {
    let rows: Array<{ key: string; value: string; set_by: string; updated_at: string }>;
    if (prefix) {
      rows = this.db
        .prepare(`SELECT * FROM memory WHERE key LIKE ? ORDER BY key`)
        .all(`${prefix}%`) as typeof rows;
    } else {
      rows = this.db.prepare(`SELECT * FROM memory ORDER BY key`).all() as typeof rows;
    }
    return rows.map((r) => this.rowToEntry(r));
  }

  delete(key: string): boolean {
    const result = this.db.prepare(`DELETE FROM memory WHERE key = ?`).run(key);
    return result.changes > 0;
  }

  private rowToEntry(r: { key: string; value: string; set_by: string; updated_at: string }): MemoryEntry {
    return {
      channelId: this.channelId,
      key: r.key,
      value: r.value,
      setBy: r.set_by,
      updatedAt: r.updated_at,
    };
  }
}
