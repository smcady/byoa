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
    console.log(`[broadcast] channel=${channelId} sender=${senderParticipantId} sessions=${sessions.length} totalSessions=${this.sessions.size}`);
    for (const session of sessions) {
      if (session.participant.id === senderParticipantId) continue;
      console.log(`[broadcast] -> sending to ${session.participant.displayName} (${session.participant.id})`);
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
        .then(() => {
          console.log(`[broadcast] -> delivered to ${session.participant.displayName}`);
        })
        .catch((err) => {
          console.error(`[broadcast] -> FAILED to deliver to ${session.participant.displayName}:`, err.message ?? err);
        });
    }
  }

  activeSessions(): number {
    return this.sessions.size;
  }

  listAll(): SessionInfo[] {
    return [...this.sessions.values()];
  }

  closeAll(): void {
    for (const info of this.sessions.values()) {
      info.transport.close().catch(() => {});
    }
    this.sessions.clear();
  }
}
