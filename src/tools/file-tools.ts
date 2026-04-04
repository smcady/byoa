import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChannelStore } from '../channel/channel-store.js';

export function registerFileTools(server: McpServer, store: ChannelStore): void {
  server.registerTool(
    'write_file',
    {
      description: 'Write a file to the shared channel storage',
      inputSchema: {
        path: z.string().describe('File path relative to channel root'),
        content: z.string().describe('File content'),
      },
    },
    async ({ path, content }) => {
      store.files.write(path, content);
      return {
        content: [{ type: 'text' as const, text: `Written: ${path}` }],
      };
    }
  );

  server.registerTool(
    'read_file',
    {
      description: 'Read a file from the shared channel storage',
      inputSchema: {
        path: z.string().describe('File path relative to channel root'),
      },
    },
    async ({ path }) => {
      const content = store.files.read(path);
      return {
        content: [{ type: 'text' as const, text: content }],
      };
    }
  );

  server.registerTool(
    'list_files',
    {
      description: 'List files in the shared channel storage',
      inputSchema: {
        path: z.string().optional().default('.').describe('Directory path relative to channel root'),
      },
    },
    async ({ path }) => {
      const entries = store.files.list(path);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entries) }],
      };
    }
  );
}
