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
      description: 'Read message history from the channel as JSON. Each message includes displayName and participantType.',
      inputSchema: {
        limit: z.number().optional().default(50).describe('Max messages to return (max 200)'),
        before: z.string().optional().describe('Message ID cursor — get messages before this one'),
        after: z.string().optional().describe('Message ID cursor — get messages after this one'),
      },
    },
    async ({ limit, before, after }) => {
      const messages = store.messages.list({ limit, before, after });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(messages) }],
      };
    }
  );

  server.registerTool(
    'read_conversation',
    {
      description: 'Read the full conversation history formatted for context. Returns a readable text transcript with participant names and roles inline. Use this to load the conversation into your context.',
      inputSchema: {
        limit: z.number().optional().default(100).describe('Max messages to return (max 500)'),
        before: z.string().optional().describe('Message ID cursor — get messages before this one'),
        after: z.string().optional().describe('Message ID cursor — get messages after this one'),
      },
    },
    async ({ limit, before, after }) => {
      const clamped = Math.min(limit, 500);
      const text = store.messages.listFormatted({ limit: clamped, before, after });
      return {
        content: [{ type: 'text' as const, text }],
      };
    }
  );
}
