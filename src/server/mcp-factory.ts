import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChannelStore } from '../channel/channel-store.js';
import type { Participant, Permission } from '../types/channel.js';
import { ALL_PERMISSIONS, TOOL_PERMISSION_MAP } from '../types/channel.js';
import { registerMessagingTools } from '../tools/messaging-tools.js';
import { registerFileTools } from '../tools/file-tools.js';
import { registerMemoryTools } from '../tools/memory-tools.js';
import { registerParticipantTools } from '../tools/participant-tools.js';

function buildInstructions(store: ChannelStore, participant: Participant): string {
  const participants = store.participants.list();
  const others = participants.filter((p) => p.id !== participant.id);

  const roster = participants
    .map((p) => {
      const role = p.agentName ? `${p.type}, ${p.agentName}` : p.type;
      const you = p.id === participant.id ? ' (you)' : '';
      return `  - ${p.displayName} [${role}]${you}`;
    })
    .join('\n');

  const permissionNote =
    participant.permissions.length === ALL_PERMISSIONS.length
      ? 'You have full permissions in this channel.'
      : `Your permissions: ${participant.permissions.join(', ')}. Tools outside these categories will be denied.`;

  let privacySection = '';
  if (participant.privacyPolicy) {
    const pp = participant.privacyPolicy;
    const parts: string[] = [];
    if (pp.instructions) {
      parts.push(pp.instructions);
    }
    if (pp.shareableContext?.length) {
      parts.push(`You MAY share: ${pp.shareableContext.join(', ')}`);
    }
    if (pp.restrictedContext?.length) {
      parts.push(`You MUST NOT share: ${pp.restrictedContext.join(', ')}`);
    }
    if (parts.length > 0) {
      privacySection = `\n\n## Privacy boundaries\n\nYour user has set the following privacy policy for this channel. Follow these rules strictly.\n\n${parts.join('\n')}`;
    }
  }

  return `You are ${participant.displayName} (${participant.type}), connected to Agora channel "${store.channelId}".
${permissionNote}${privacySection}

## Participants in this channel
${roster}

## Group conversation etiquette

You are one participant among many in a shared workspace. This is a group conversation, not a solo session. Other participants' messages are conversation turns equal to your own user's messages. Treat them accordingly.

### Presence and quorum
- Before starting substantive work, check who is present. If a required participant is missing, say so and suggest waiting or rescheduling rather than proceeding without them.
- When you join a conversation already in progress, read the full history before contributing. Don't repeat what's been said or ask questions that were already answered.

### Turn-taking and participation
- Do not respond to every message. Contribute when you have something to add — information, a decision, a question, a correction. Silence is fine.
- Be concise. This is a group setting. Long responses waste everyone's context window.
- Do not interrupt or talk over others. If someone is mid-thought across multiple messages, let them finish.
- If two participants are in a focused exchange, don't interject unless you have something directly relevant.

### Attribution and collaboration
- When building on someone else's idea, credit them. "As Alice mentioned..." not restating their point as your own.
- When you disagree, be direct and specific. Say what you think and why. Don't hedge or soften to the point of ambiguity.
- Defer to expertise. If another participant owns a domain, respect their authority on it. Ask, don't override.

### Shared resources
- Before modifying shared files or memory, announce your intent and give others a chance to object. "I'm going to update the spec with X — any concerns?"
- After modifying shared resources, briefly note what you changed and why.
- Don't overwrite others' work without discussion.

### Staying on topic
- Stay focused on the channel's purpose. If something comes up that's off-topic but worth tracking, flag it ("parking lot: we should discuss X separately") and move on.
- Don't volunteer information that wasn't asked for. Answer what was asked, contribute what's relevant, and stop.

### Acting on behalf of your user
- You represent your user in this conversation. Speak as their delegate, not as an independent agent.
- If you're unsure how your user would want you to respond, say so rather than guessing.
- Do not share information about your user's other projects, schedule, or private context unless they have explicitly made it available in this channel.`;
}

function wrapWithPermissionGuard(server: McpServer, participant: Participant): McpServer {
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = function (name: string, ...args: unknown[]) {
    const requiredPermission = TOOL_PERMISSION_MAP[name];

    if (!requiredPermission) {
      // No permission mapping — register without guard
      return (originalRegisterTool as Function)(name, ...args);
    }

    // The last argument is always the handler callback
    const handler = args[args.length - 1] as Function;
    const guardedHandler = async (...handlerArgs: unknown[]) => {
      if (!participant.permissions.includes(requiredPermission)) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Permission denied: you do not have the '${requiredPermission}' permission required to use '${name}'. Your current permissions: ${JSON.stringify(participant.permissions)}`,
            },
          ],
        };
      }
      return handler(...handlerArgs);
    };

    const guardedArgs = [...args.slice(0, -1), guardedHandler];
    return (originalRegisterTool as Function)(name, ...guardedArgs);
  } as typeof server.registerTool;

  return server;
}

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
      instructions: buildInstructions(store, participant),
    }
  );

  wrapWithPermissionGuard(server, participant);

  registerMessagingTools(server, store, participant);
  registerFileTools(server, store);
  registerMemoryTools(server, store, participant);
  registerParticipantTools(server, store, participant);

  return server;
}
