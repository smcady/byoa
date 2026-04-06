#!/usr/bin/env node

import { channelCreate } from './commands/channel-create.js';
import { channelList } from './commands/channel-list.js';
import { invite } from './commands/invite.js';
import { join } from './commands/join.js';
import { status } from './commands/status.js';
import { loadConfig, saveConfig } from './config.js';

const rawArgs = process.argv.slice(2);

// Extract --server flag before command parsing
let serverOverride: string | undefined;
const args: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--server' && i + 1 < rawArgs.length) {
    serverOverride = rawArgs[i + 1];
    i++; // skip value
  } else {
    args.push(rawArgs[i]);
  }
}

// Apply server override to config
if (serverOverride) {
  const config = loadConfig();
  config.serverUrl = serverOverride.replace(/\/$/, ''); // strip trailing slash
  saveConfig(config);
}

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
        const joinArgs = args.slice(1);
        const launchFlag = joinArgs.includes('--launch');
        const joinInput = joinArgs.find((a) => !a.startsWith('--'));
        await join(joinInput ?? '', launchFlag);
        break;
      }

      case 'status': {
        await status(args[1]);
        break;
      }

      default:
        console.log(`
Agora CLI — multi-user multi-agent workspace

Usage:
  agora [--server <url>] <command> [options]

Commands:
  agora channel create <name>     Create a new channel
  agora channel list              List all channels
  agora invite <name> [options]   Invite a participant (outputs a join command)
  agora join <join-string>        Join a channel and configure Claude Code
  agora status                    Show active channel and participants

Server:
  --server <url>                  Set the Agora server URL (saved for future commands)
                                  Default: http://localhost:3737

Invite options:
  --type <human|agent>            Participant type (default: human)
  --agent-name <name>             Agent name (e.g. claude-code)
  --channel <id>                  Target channel (default: active channel)

Quick start (admin):
  agora --server https://your-server.example.com channel create my-project
  agora invite "Alice Agent" --type agent --agent-name claude-code

Quick start (colleague):
  npx agora join <join-string>    # paste the string from the invite output
`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
