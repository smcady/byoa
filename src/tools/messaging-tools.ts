import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChannelStore } from '../channel/channel-store.js';
import type { Participant, Message } from '../types/channel.js';

export function registerMessagingTools(
  server: McpServer,
  store: ChannelStore,
  participant: Participant
): void {
  // Track the rowid at the time wait_for_messages last resolved.
  // Used by send_message to detect new messages that arrived during COT.
  let lastDeliveredRowid = 0;

  // Track whether this is the first send after a checkpoint bounce.
  // If true, send unconditionally (cap bounces at 1).
  let checkpointUsed = false;

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
      // Layer 2: Checkpoint — check for new messages since wait_for_messages resolved.
      // Skip checkpoint if we already bounced once (cap at 1).
      if (!checkpointUsed && lastDeliveredRowid > 0) {
        const newMessages = store.getMessagesSinceRowid(lastDeliveredRowid, participant.id);

        if (newMessages.length > 0) {
          // New messages arrived while the agent was composing.
          // Don't send yet — return the new context and let the agent decide.
          checkpointUsed = true; // Next send will go through unconditionally

          const authors = [...new Set(newMessages.map((m) => m.displayName ?? m.participantId))];
          store.logCoordination(
            participant.id, participant.displayName, 'checkpoint_bounce',
            `draft_len=${content.length} new_msgs=${newMessages.length} from=${authors.join(',')}`
          );

          const newContext = newMessages
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
                text:
                  `⚡ New messages arrived while you were composing:\n\n` +
                  `${newContext}\n\n` +
                  `Your draft: "${content}"\n\n` +
                  `Review the new messages alongside your draft. Then either:\n` +
                  `- Call send_message again with your original or revised content to send\n` +
                  `- Call wait_for_messages to skip and keep listening`,
              },
            ],
          };
        }
      }

      // Post the message
      store.logCoordination(
        participant.id, participant.displayName,
        checkpointUsed ? 'send_after_bounce' : 'send',
        `len=${content.length}`
      );
      const msg = store.addMessage(participant.id, content, type);
      checkpointUsed = false; // Reset for next cycle

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
        'Block until new messages arrive in the channel, then return them along with ' +
        'composing indicators and recent context. Use this in a loop: ' +
        'wait_for_messages → respond if needed → wait_for_messages. ' +
        'Read everything returned before deciding whether to respond.',
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

      // Clear composing state — we're now waiting
      store.clearComposing(participant.id);
      checkpointUsed = false; // Reset checkpoint for new cycle

      const triggerMessage = await new Promise<Message | null>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;

        const handler = (msg: Message) => {
          // Don't trigger on our own messages
          if (msg.participantId === participant.id) return;
          clearTimeout(timer);
          store.removeListener('message:new', handler);
          resolve(msg);
        };

        store.on('message:new', handler);

        timer = setTimeout(() => {
          store.removeListener('message:new', handler);
          resolve(null);
        }, timeout);
      });

      if (!triggerMessage) {
        store.logCoordination(participant.id, participant.displayName, 'wait_timeout');
        return {
          content: [
            {
              type: 'text' as const,
              text: '(no new messages — timed out. Call wait_for_messages again to keep listening)',
            },
          ],
        };
      }

      // Mark ourselves as composing — other agents will see this
      store.setComposing(participant.id, participant.displayName);

      // Record the current rowid for the send_message checkpoint
      lastDeliveredRowid = store.getLatestRowid();

      // Layer 1: Rich context — include composing state and recent messages
      const othersComposing = store.getComposing(participant.id);

      const triggerAuthor = triggerMessage.displayName ?? triggerMessage.participantId;
      store.logCoordination(
        participant.id, participant.displayName, 'wait_resolved',
        `trigger_from=${triggerAuthor} composing=[${othersComposing.join(',')}]`
      );
      const recentMessages = store.messages.list({ limit: 15 });

      const parts: string[] = [];

      if (othersComposing.length > 0) {
        parts.push(`Currently composing: ${othersComposing.join(', ')}`);
      }

      parts.push('--- Recent messages ---');
      for (const m of recentMessages) {
        const name = m.displayName ?? m.participantId;
        const role = m.agentName ? `${m.agentName}` : m.participantType ?? 'unknown';
        parts.push(`[${name} (${role})] ${m.content}`);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: parts.join('\n\n'),
          },
        ],
      };
    }
  );
}
