import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChannelStore } from '../channel/channel-store.js';
import type { Participant } from '../types/channel.js';

export function registerMessagingTools(
  server: McpServer,
  store: ChannelStore,
  participant: Participant
): void {
  server.registerTool(
    'send_message',
    {
      description: 'Send a message to the channel',
      inputSchema: {
        content: z.string().describe('The message content'),
        type: z
          .enum(['text', 'tool_result', 'file_share', 'system'])
          .optional()
          .default('text')
          .describe('Message type'),
      },
    },
    async ({ content, type }) => {
      const msg = store.addMessage(participant.id, content, type);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: msg.id,
              participantId: msg.participantId,
              createdAt: msg.createdAt,
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    'read_history',
    {
      description: 'Read message history from the channel',
      inputSchema: {
        limit: z.number().optional().default(50).describe('Max messages to return (max 200)'),
        before: z.string().optional().describe('ISO timestamp cursor — get messages before this time'),
        after: z.string().optional().describe('ISO timestamp cursor — get messages after this time'),
      },
    },
    async ({ limit, before, after }) => {
      const messages = store.messages.list({ limit, before, after });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(messages) }],
      };
    }
  );
}
