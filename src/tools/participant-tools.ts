import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChannelStore } from '../channel/channel-store.js';
import type { Participant } from '../types/channel.js';

export function registerParticipantTools(
  server: McpServer,
  store: ChannelStore,
  participant: Participant
): void {
  server.registerTool(
    'list_participants',
    {
      description: 'List all participants in this channel',
    },
    async () => {
      const participants = store.participants.list().map((p) => ({
        id: p.id,
        userId: p.userId,
        displayName: p.displayName,
        type: p.type,
        agentName: p.agentName,
        joinedAt: p.joinedAt,
        lastSeenAt: p.lastSeenAt,
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(participants) }],
      };
    }
  );

  server.registerTool(
    'whoami',
    {
      description: 'Get your own participant identity in this channel',
    },
    async () => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: participant.id,
              userId: participant.userId,
              displayName: participant.displayName,
              type: participant.type,
              agentName: participant.agentName,
              channelId: participant.channelId,
              permissions: participant.permissions,
            }),
          },
        ],
      };
    }
  );
}
