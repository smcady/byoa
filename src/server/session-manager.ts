import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Participant } from '../types/channel.js';

export interface SessionInfo {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  participant: Participant;
  channelId: string;
}

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  register(sessionId: string, info: SessionInfo): void {
    this.sessions.set(sessionId, info);
  }

  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  listByChannel(channelId: string): SessionInfo[] {
    return [...this.sessions.values()].filter((s) => s.channelId === channelId);
  }

  closeAll(): void {
    for (const info of this.sessions.values()) {
      info.transport.close().catch(() => {});
    }
    this.sessions.clear();
  }
}
