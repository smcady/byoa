import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChannelStore } from '../channel/channel-store.js';
import type { Participant } from '../types/channel.js';

export function registerMemoryTools(
  server: McpServer,
  store: ChannelStore,
  participant: Participant
): void {
  server.registerTool(
    'memory_get',
    {
      description: 'Get a value from the shared channel memory',
      inputSchema: {
        key: z.string().describe('Memory key'),
      },
    },
    async ({ key }) => {
      const entry = store.memory.get(key);
      return {
        content: [
          {
            type: 'text' as const,
            text: entry ? JSON.stringify(entry) : 'null',
          },
        ],
      };
    }
  );

  server.registerTool(
    'memory_set',
    {
      description: 'Set a value in the shared channel memory',
      inputSchema: {
        key: z.string().describe('Memory key (use dot notation for namespacing, e.g. "project.status")'),
        value: z.string().describe('Value to store (JSON string recommended for structured data)'),
      },
    },
    async ({ key, value }) => {
      const entry = store.memory.set(key, value, participant.id);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entry) }],
      };
    }
  );

  server.registerTool(
    'memory_list',
    {
      description: 'List keys in the shared channel memory',
      inputSchema: {
        prefix: z.string().optional().describe('Filter keys by prefix'),
      },
    },
    async ({ prefix }) => {
      const entries = store.memory.list(prefix);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entries) }],
      };
    }
  );

  server.registerTool(
    'memory_delete',
    {
      description: 'Delete a key from the shared channel memory',
      inputSchema: {
        key: z.string().describe('Memory key to delete'),
      },
    },
    async ({ key }) => {
      const deleted = store.memory.delete(key);
      return {
        content: [
          { type: 'text' as const, text: deleted ? 'Deleted' : 'Key not found' },
        ],
      };
    }
  );
}
