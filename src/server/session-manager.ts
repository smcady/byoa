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
   * Push a new message to all connected sessions in the channel except the sender.
   * Uses MCP elicitation (form mode) so Claude Code treats it as an interactive prompt
   * requiring a response, not a passive log notification.
   * Falls back to sendLoggingMessage if elicitation is not supported by the client.
   */
  broadcastMessage(channelId: string, message: Message, senderParticipantId: string): void {
    const sessions = this.listByChannel(channelId);
    console.log(`[broadcast] channel=${channelId} sender=${senderParticipantId} sessions=${sessions.length} totalSessions=${this.sessions.size}`);

    for (const session of sessions) {
      if (session.participant.id === senderParticipantId) continue;

      const name = message.displayName ?? message.participantId;
      const role = message.agentName ? `${message.agentName}` : message.participantType ?? 'unknown';
      const label = `${name} [${role}]`;

      console.log(`[broadcast] -> sending to ${session.participant.displayName} (${session.participant.id})`);

      // Try elicitation first — this actually prompts the agent to respond
      const lowLevelServer = session.server.server;
      lowLevelServer
        .elicitInput({
          mode: 'form',
          message: `New message from ${label}:\n\n${message.content}\n\nUse send_message to respond if appropriate, or dismiss if no response needed.`,
          requestedSchema: {
            type: 'object' as const,
            properties: {
              acknowledged: {
                type: 'boolean' as const,
                title: 'Message received',
                description: `${label}: ${message.content}`,
                default: true,
              },
            },
          },
        })
        .then((result) => {
          console.log(`[broadcast] -> elicitation result from ${session.participant.displayName}: ${result.action}`);
        })
        .catch((err) => {
          console.log(`[broadcast] -> elicitation failed for ${session.participant.displayName}: ${err.message ?? err}, falling back to logging`);
          // Fall back to logging notification
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
              console.log(`[broadcast] -> logging fallback delivered to ${session.participant.displayName}`);
            })
            .catch((err2) => {
              console.error(`[broadcast] -> logging fallback FAILED for ${session.participant.displayName}:`, err2.message ?? err2);
            });
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
