import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Participant, Message } from '../types/channel.js';

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

  /**
   * Push a new message notification to all connected sessions in the channel
   * except the sender. Uses MCP logging notifications as the delivery mechanism.
   */
  broadcastMessage(channelId: string, message: Message, senderParticipantId: string): void {
    const sessions = this.listByChannel(channelId);
    for (const session of sessions) {
      if (session.participant.id === senderParticipantId) continue;
      session.server
        .sendLoggingMessage({
          level: 'info',
          logger: 'agora',
          data: {
            type: 'message:new',
            message: {
              id: message.id,
              participantId: message.participantId,
              displayName: message.displayName,
              participantType: message.participantType,
              agentName: message.agentName,
              type: message.type,
              content: message.content,
              createdAt: message.createdAt,
            },
          },
        })
        .catch(() => {
          // Session may have disconnected — ignore
        });
    }
  }

  closeAll(): void {
    for (const info of this.sessions.values()) {
      info.transport.close().catch(() => {});
    }
    this.sessions.clear();
  }
}
