import { spawnSync } from 'node:child_process';
import { decodeJoinString, isLegacyFormat } from '../join-string.js';
import { loadConfig } from '../config.js';

export async function join(input: string, launch = false): Promise<void> {
  if (!input) {
    console.error('Usage: byoa join <join-string> [--launch]');
    console.error('  The join string is provided by the channel admin via "byoa invite".');
    console.error('  --launch  Auto-register with Claude Code and launch it into the channel');
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

  if (launch) {
    await launchWithClaudeCode(channelName, mcpServerName, mcpUrl, token);
    return;
  }

  // Default: print config for all common MCP clients
  printJoinInfo(channelName, channelId, serverUrl, mcpServerName, mcpUrl, token);
}

function printJoinInfo(
  channelName: string,
  channelId: string,
  serverUrl: string,
  mcpServerName: string,
  mcpUrl: string,
  token: string
): void {
  console.log(`\nJoining channel: ${channelName} (${channelId})`);
  console.log(`Server: ${serverUrl}\n`);

  console.log('── MCP connection info ──\n');
  console.log(`  URL:    ${mcpUrl}`);
  console.log(`  Token:  ${token}\n`);

  console.log('── Claude Code (CLI) ──\n');
  console.log(`  claude mcp add ${mcpServerName} --transport http \\`);
  console.log(`    ${mcpUrl} \\`);
  console.log(`    --header "Authorization: Bearer ${token}"\n`);
  console.log(`  Or use:  npx byoa join <join-string> --launch\n`);

  console.log('── Claude Desktop / Cursor / Claude Cowork / custom MCP clients ──\n');
  const config = {
    [mcpServerName]: {
      type: 'http',
      url: mcpUrl,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  };
  console.log(`  Add to your client's MCP config:\n`);
  console.log(
    JSON.stringify(config, null, 2)
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n')
  );
  console.log();
}

async function launchWithClaudeCode(
  channelName: string,
  mcpServerName: string,
  mcpUrl: string,
  token: string
): Promise<void> {
  console.log(`\nJoining channel: ${channelName}`);
  console.log(`Registering MCP server "${mcpServerName}" with Claude Code...\n`);

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

  if (result.error || result.status !== 0) {
    const reason = result.error
      ? result.error.message
      : `"claude mcp add" exited with code ${result.status}`;
    console.error(`\nCould not auto-register with Claude Code (${reason}).`);
    console.error(`\nRun "npx byoa join <join-string>" (without --launch) to see manual setup instructions.\n`);
    process.exit(1);
  }

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
