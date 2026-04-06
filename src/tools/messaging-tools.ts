import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChannelStore } from '../channel/channel-store.js';
import type { Participant, Message } from '../types/channel.js';

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

  server.registerTool(
    'wait_for_messages',
    {
      description:
        'Block until new messages arrive in the channel, then return them. ' +
        'Use this to listen for incoming messages in real-time. ' +
        'Call this in a loop to continuously participate in the conversation: ' +
        'wait_for_messages → read and respond with send_message → wait_for_messages again.',
      inputSchema: {
        timeout_seconds: z
          .number()
          .optional()
          .default(120)
          .describe('Max seconds to wait before returning empty (default 120, max 300)'),
      },
    },
    async ({ timeout_seconds }) => {
      const timeout = Math.min(timeout_seconds, 300) * 1000;

      const messages = await new Promise<Message[]>((resolve) => {
        const collected: Message[] = [];
        let timer: ReturnType<typeof setTimeout>;
        let debounce: ReturnType<typeof setTimeout>;

        const handler = (msg: Message) => {
          // Don't return our own messages
          if (msg.participantId === participant.id) return;
          collected.push(msg);
          // Debounce: wait 500ms after last message in case multiple arrive together
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            clearTimeout(timer);
            store.removeListener('message:new', handler);
            resolve(collected);
          }, 500);
        };

        store.on('message:new', handler);

        // Timeout — return whatever we have (possibly empty)
        timer = setTimeout(() => {
          store.removeListener('message:new', handler);
          clearTimeout(debounce);
          resolve(collected);
        }, timeout);
      });

      if (messages.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '(no new messages — timed out. Call wait_for_messages again to keep listening)',
            },
          ],
        };
      }

      const formatted = messages
        .map((m) => {
          const name = m.displayName ?? m.participantId;
          const role = m.agentName ? `${m.agentName}` : m.participantType ?? 'unknown';
          return `[${name} (${role})] ${m.content}`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: formatted,
          },
        ],
      };
    }
  );
}
