#!/usr/bin/env node

import { channelCreate } from './commands/channel-create.js';
import { channelList } from './commands/channel-list.js';
import { invite } from './commands/invite.js';
import { join } from './commands/join.js';
import { status } from './commands/status.js';

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1];
      i++;
    }
  }
  return flags;
}

function getPositional(args: string[]): string[] {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip flag value
    } else {
      positional.push(args[i]);
    }
  }
  return positional;
}

async function main() {
  try {
    switch (command) {
      case 'channel': {
        const sub = args[1];
        if (sub === 'create') {
          await channelCreate(args[2]);
        } else if (sub === 'list' || sub === 'ls') {
          await channelList();
        } else {
          console.log('Usage: agora channel <create|list>');
        }
        break;
      }

      case 'invite': {
        const restArgs = args.slice(1);
        const positional = getPositional(restArgs);
        const flags = parseFlags(restArgs);
        await invite({
          displayName: positional[0],
          type: flags.type ?? 'human',
          agentName: flags['agent-name'],
          channelId: flags.channel,
        });
        break;
      }

      case 'join': {
        await join(args[1]);
        break;
      }

      case 'status': {
        await status(args[1]);
        break;
      }

      default:
        console.log(`
Agora CLI — multi-user multi-agent workspace

Commands:
  agora channel create <name>     Create a new channel
  agora channel list              List all channels
  agora invite <name> [options]   Invite a participant to the active channel
  agora join <channelId:token>    Join a channel and configure MCP
  agora status                    Show active channel and participants

Invite options:
  --type <human|agent>            Participant type (default: human)
  --agent-name <name>             Agent name (e.g. claude-code)
  --channel <id>                  Target channel (default: active channel)

Examples:
  agora channel create my-project
  agora invite "Alice Claude" --type agent --agent-name claude-code
  agora invite "Bob" --type human
  agora join chan_abc123:agora_tok_xyz...
  agora status
`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
