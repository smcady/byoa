import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Participant, Message } from '../types/channel.js';

export interface SessionInfo {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  participant: Participant;
  channelId: string;
  lastActivity: number; // Date.now() timestamp
}

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  register(sessionId: string, info: SessionInfo): void {
    info.lastActivity = Date.now();
    this.sessions.set(sessionId, info);
  }

  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /** Update last activity timestamp for a session. */
  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.lastActivity = Date.now();
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  listByChannel(channelId: string): SessionInfo[] {
    return [...this.sessions.values()].filter((s) => s.channelId === channelId);
  }

  /**
   * Push a new message notification to all connected sessions in the channel
   * except the sender. Uses MCP logging notifications as an informational signal.
   *
   * Note: The primary delivery mechanism for agents is the `wait_for_messages`
   * tool, which blocks until a message:new event fires on the ChannelStore.
   * This broadcast serves as a supplementary notification.
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
          console.error(`[broadcast] -> FAILED to deliver to ${session.participant.displayName}, removing dead session:`, err.message ?? err);
          // Find and remove this dead session
          for (const [sid, s] of this.sessions) {
            if (s === session) {
              this.sessions.delete(sid);
              break;
            }
          }
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
