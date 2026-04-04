import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChannelStore } from '../channel/channel-store.js';
import type { Participant } from '../types/channel.js';
import { registerMessagingTools } from '../tools/messaging-tools.js';
import { registerFileTools } from '../tools/file-tools.js';
import { registerMemoryTools } from '../tools/memory-tools.js';
import { registerParticipantTools } from '../tools/participant-tools.js';

export function createChannelMcpServer(
  store: ChannelStore,
  participant: Participant
): McpServer {
  const server = new McpServer(
    {
      name: `agora-${store.channelId}`,
      version: '0.1.0',
    },
    {
      capabilities: { tools: {} },
      instructions: `You are connected to Agora channel "${store.channelId}" as ${participant.displayName} (${participant.type}). Use the available tools to collaborate with other participants.`,
    }
  );

  registerMessagingTools(server, store, participant);
  registerFileTools(server, store);
  registerMemoryTools(server, store, participant);
  registerParticipantTools(server, store, participant);

  return server;
}
