import { spawnSync } from 'node:child_process';
import { decodeJoinString, isLegacyFormat } from '../join-string.js';
import { loadConfig } from '../config.js';

export async function join(input: string, launch = false): Promise<void> {
  if (!input) {
    console.error('Usage: byoa join <join-string> [--launch]');
    console.error('  The join string is provided by the channel admin via "byoa invite".');
    console.error('  --launch  Register MCP and immediately start Claude Code in the channel');
    process.exit(1);
  }

  // Decode join string (supports both new base64 and legacy channelId:token format)
  let serverUrl: string;
  let channelId: string;
  let token: string;

  if (isLegacyFormat(input)) {
    const colonIdx = input.indexOf(':byoa_tok_');
    channelId = input.slice(0, colonIdx);
    token = input.slice(colonIdx + 1);
    serverUrl = loadConfig().serverUrl;
    console.log(`(Legacy format detected — using server URL from config: ${serverUrl})`);
  } else {
    ({ serverUrl, channelId, token } = decodeJoinString(input));
  }

  // Fetch channel name for a nicer MCP server name
  let channelName = channelId;
  try {
    const res = await fetch(`${serverUrl}/api/channels`);
    const body = (await res.json()) as {
      channels: Array<{ id: string; name: string }>;
    };
    const ch = body.channels.find((c) => c.id === channelId);
    if (ch) channelName = ch.name;
  } catch {
    // Server not reachable — use channel ID as fallback name
  }

  const safeName = channelName.toLowerCase().replace(/\s+/g, '-');
  const mcpServerName = `byoa-${safeName}`;
  const mcpUrl = `${serverUrl}/mcp/${channelId}`;

  // Register via `claude mcp add`
  console.log(`\nJoining channel: ${channelName} (${channelId})`);
  console.log(`Server: ${serverUrl}`);
  console.log(`Registering MCP server "${mcpServerName}"...\n`);

  const result = spawnSync(
    'claude',
    [
      'mcp', 'add', mcpServerName,
      '--transport', 'http',
      mcpUrl,
      '--header', `Authorization: Bearer ${token}`,
    ],
    { stdio: 'inherit' }
  );

  if (result.error) {
    console.error(`Could not run "claude mcp add" (${result.error.message}).`);
    console.log(`\nManual setup — add this to your Claude Code MCP settings:\n`);
    printManualConfig(mcpServerName, mcpUrl, token);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n"claude mcp add" exited with code ${result.status}.`);
    console.log(`\nManual setup — add this to your Claude Code MCP settings:\n`);
    printManualConfig(mcpServerName, mcpUrl, token);
    process.exit(1);
  }

  if (launch) {
    console.log(`\nLaunching Claude Code into the channel...\n`);
    const launchResult = spawnSync(
      'claude',
      [
        `You are a BYOA agent in channel "${channelName}". ` +
        `Call whoami, then read_conversation to catch up, respond if needed, ` +
        `then call wait_for_messages and stay in a wait → respond → wait loop.`,
      ],
      { stdio: 'inherit' }
    );
    process.exit(launchResult.status ?? 0);
  }

  console.log(`\nDone! MCP server registered.`);
  console.log(`Start Claude Code and it will auto-connect to the channel.\n`);
}

function printManualConfig(name: string, url: string, token: string): void {
  const config = {
    [name]: {
      type: 'http',
      url,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  };
  console.log(JSON.stringify(config, null, 2));
  console.log();
}
