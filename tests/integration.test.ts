import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'node:http';
import { ChannelManager } from '../src/channel/channel-manager.js';
import { createApp } from '../src/server/http-server.js';
import { generateToken, hashToken } from '../src/auth/tokens.js';

const TEST_ADMIN_KEY = 'test-admin-key-for-integration';

let server: Server;
let baseUrl: string;
let tmpDir: string;
let channelManager: ChannelManager;

beforeAll(async () => {
  process.env.BYOA_ADMIN_KEY = TEST_ADMIN_KEY;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byoa-int-test-'));
  channelManager = new ChannelManager(tmpDir);
  const { app } = createApp(channelManager);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(() => {
  delete process.env.BYOA_ADMIN_KEY;
  channelManager.closeAll();
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Test helpers ──────────────────────────────────────────────

async function createChannel(name: string) {
  const res = await fetch(`${baseUrl}/api/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_ADMIN_KEY}`,
    },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

async function invite(
  channelId: string,
  adminToken: string,
  opts: {
    userId: string;
    displayName: string;
    type?: string;
    agentName?: string;
    permissions?: string[];
    privacyPolicy?: object;
  }
) {
  const res = await fetch(`${baseUrl}/api/channels/${channelId}/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(opts),
  });
  return { status: res.status, body: await res.json() };
}

async function mcpInit(channelId: string, token: string) {
  const initRes = await fetch(`${baseUrl}/mcp/${channelId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      },
    }),
  });
  const sessionId = initRes.headers.get('mcp-session-id')!;
  const body = await initRes.json();

  // Send initialized notification
  await fetch(`${baseUrl}/mcp/${channelId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });

  return { sessionId, initBody: body };
}

async function mcpToolCall(
  channelId: string,
  token: string,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown> = {}
) {
  const res = await fetch(`${baseUrl}/mcp/${channelId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  return { status: res.status, body: await res.json() };
}

// ─── Admin API tests ─────────────────────────────────────────

describe('Admin API', () => {
  it('creates a channel and returns admin token', async () => {
    const body = await createChannel('Integration Test');
    expect(body.channel.name).toBe('Integration Test');
    expect(body.adminToken).toMatch(/^byoa_tok_/);
    expect(body.mcpEndpoint).toMatch(/^\/mcp\/chan_/);
  });

  it('invites a participant and returns MCP config', async () => {
    const { channel, adminToken } = await createChannel('Invite Test');
    const { status, body } = await invite(channel.id, adminToken, {
      userId: 'alice',
      displayName: "Alice's Claude",
      type: 'agent',
      agentName: 'claude-code',
    });
    expect(status).toBe(201);
    expect(body.participant.displayName).toBe("Alice's Claude");
    expect(body.token).toMatch(/^byoa_tok_/);
    expect(body.mcpConfig.type).toBe('streamableHttp');
  });

  it('invites with custom permissions', async () => {
    const { channel, adminToken } = await createChannel('Perms Invite');
    const { body } = await invite(channel.id, adminToken, {
      userId: 'limited',
      displayName: 'Limited',
      type: 'agent',
      permissions: ['messaging', 'participants'],
    });
    expect(body.participant.permissions).toEqual(['messaging', 'participants']);
  });

  it('invites with privacy policy', async () => {
    const { channel, adminToken } = await createChannel('Privacy Invite');
    const { body } = await invite(channel.id, adminToken, {
      userId: 'private',
      displayName: 'Private Agent',
      type: 'agent',
      privacyPolicy: { instructions: 'Share nothing.' },
    });
    expect(body.participant).toBeTruthy();
  });

  it('rejects invalid permissions', async () => {
    const { channel, adminToken } = await createChannel('Bad Perms');
    const res = await fetch(`${baseUrl}/api/channels/${channel.id}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        userId: 'bad',
        displayName: 'Bad',
        permissions: ['nonexistent_perm'],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('lists channels', async () => {
    const res = await fetch(`${baseUrl}/api/channels`, {
      headers: { Authorization: `Bearer ${TEST_ADMIN_KEY}` },
    });
    const body = await res.json();
    expect(body.channels.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects unauthenticated invites', async () => {
    const { channel } = await createChannel('Auth Test');
    const inviteRes = await fetch(`${baseUrl}/api/channels/${channel.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'bob', displayName: 'Bob' }),
    });
    expect(inviteRes.status).toBe(401);
  });

  it('lists participants in a channel', async () => {
    const { channel, adminToken } = await createChannel('List Parts');
    await invite(channel.id, adminToken, {
      userId: 'u1', displayName: 'User 1',
    });
    const res = await fetch(`${baseUrl}/api/channels/${channel.id}/participants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    // Admin + invited user
    expect(body.participants).toHaveLength(2);
  });

  it('removes a participant', async () => {
    const { channel, adminToken } = await createChannel('Remove Test');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'removeme', displayName: 'Remove Me',
    });
    const res = await fetch(
      `${baseUrl}/api/channels/${channel.id}/participants/${invBody.participant.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    expect(res.status).toBe(200);
  });

  it('updates participant permissions via PATCH', async () => {
    const { channel, adminToken } = await createChannel('Patch Perms');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'patchme', displayName: 'Patch Me', permissions: ['participants'],
    });
    const res = await fetch(
      `${baseUrl}/api/channels/${channel.id}/participants/${invBody.participant.id}/permissions`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ permissions: ['participants', 'messaging'] }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permissions).toEqual(['participants', 'messaging']);
  });

  it('updates privacy policy via PATCH', async () => {
    const { channel, adminToken } = await createChannel('Patch Privacy');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'priv', displayName: 'Priv Agent',
    });
    const res = await fetch(
      `${baseUrl}/api/channels/${channel.id}/participants/${invBody.participant.id}/privacy`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ privacyPolicy: { instructions: 'Be careful' } }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.privacyPolicy.instructions).toBe('Be careful');

    // Clear it
    const clearRes = await fetch(
      `${baseUrl}/api/channels/${channel.id}/participants/${invBody.participant.id}/privacy`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ privacyPolicy: null }),
      }
    );
    const clearBody = await clearRes.json();
    expect(clearBody.privacyPolicy).toBeNull();
  });

  it('health check returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});

// ─── MCP endpoint tests ──────────────────────────────────────

describe('MCP endpoint', () => {
  it('initializes an MCP session for authenticated agent', async () => {
    const { channel, adminToken } = await createChannel('MCP Test');
    const { sessionId, initBody } = await mcpInit(channel.id, adminToken);
    expect(sessionId).toBeTruthy();
    expect(initBody.result.serverInfo.name).toMatch(/^byoa-/);
  });

  it('rejects unauthenticated MCP requests', async () => {
    const { channel } = await createChannel('Auth MCP Test');
    const res = await fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.1.0' },
        },
      }),
    });
    expect(res.status).toBe(401);
  });

  it('two agents can exchange messages through a shared channel', async () => {
    const { channel, adminToken } = await createChannel('Collab Test');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'bob', displayName: "Bob's Agent", type: 'agent', agentName: 'gpt',
    });

    const agentA = await mcpInit(channel.id, adminToken);
    const agentB = await mcpInit(channel.id, invBody.token);

    // Agent A sends
    await mcpToolCall(channel.id, adminToken, agentA.sessionId, 'send_message', {
      content: 'Hello from Agent A!',
    });

    // Agent B reads
    const { body: readBody } = await mcpToolCall(
      channel.id, invBody.token, agentB.sessionId, 'read_history', {}
    );
    const messages = JSON.parse(readBody.result.content[0].text);
    expect(messages.some((m: { content: string }) => m.content === 'Hello from Agent A!')).toBe(true);
  });
});

// ─── Session security tests ──────────────────────────────────

describe('Session security', () => {
  it('rejects session hijacking — different token on existing session', async () => {
    const { channel, adminToken } = await createChannel('Hijack Test');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'other', displayName: 'Other',
    });

    // Admin creates a session
    const { sessionId } = await mcpInit(channel.id, adminToken);

    // Other user tries to use admin's session ID
    const res = await fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${invBody.token}`,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects removed participants token', async () => {
    const { channel, adminToken } = await createChannel('Removed Token Test');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'removable', displayName: 'Removable',
    });

    // Remove the participant
    await fetch(
      `${baseUrl}/api/channels/${channel.id}/participants/${invBody.participant.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );

    // Try to init MCP with removed token
    const res = await fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${invBody.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.1.0' },
        },
      }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── Channel isolation tests ─────────────────────────────────

describe('Channel isolation', () => {
  it('messages in one channel are not visible in another', async () => {
    const ch1 = await createChannel('Isolated A');
    const ch2 = await createChannel('Isolated B');

    const s1 = await mcpInit(ch1.channel.id, ch1.adminToken);
    const s2 = await mcpInit(ch2.channel.id, ch2.adminToken);

    // Send in channel 1
    await mcpToolCall(ch1.channel.id, ch1.adminToken, s1.sessionId, 'send_message', {
      content: 'Secret message in channel 1',
    });

    // Read from channel 2
    const { body } = await mcpToolCall(
      ch2.channel.id, ch2.adminToken, s2.sessionId, 'read_history', {}
    );
    const msgs = JSON.parse(body.result.content[0].text);
    expect(msgs).toHaveLength(0);
  });

  it('token from one channel cannot access another', async () => {
    const ch1 = await createChannel('Cross A');
    const ch2 = await createChannel('Cross B');

    // Try to use ch1's token on ch2's MCP endpoint
    const res = await fetch(`${baseUrl}/mcp/${ch2.channel.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${ch1.adminToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.1.0' },
        },
      }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── Permission enforcement tests ────────────────────────────

describe('Permission enforcement', () => {
  it('denies tool calls without required permission', async () => {
    const { channel, adminToken } = await createChannel('Perm Enforce');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'readonly',
      displayName: 'Read Only',
      type: 'agent',
      permissions: ['files_read', 'participants'],
    });

    const { sessionId } = await mcpInit(channel.id, invBody.token);

    // send_message requires 'messaging' — should be denied
    const { body: sendBody } = await mcpToolCall(
      channel.id, invBody.token, sessionId, 'send_message', { content: 'blocked' }
    );
    expect(sendBody.result.isError).toBe(true);
    expect(sendBody.result.content[0].text).toContain('Permission denied');

    // whoami requires 'participants' — should work
    const { body: whoBody } = await mcpToolCall(
      channel.id, invBody.token, sessionId, 'whoami', {}
    );
    expect(whoBody.result.isError).toBeUndefined();
    const identity = JSON.parse(whoBody.result.content[0].text);
    expect(identity.permissions).toEqual(['files_read', 'participants']);
  });

  it('denies memory write but allows memory read', async () => {
    const { channel, adminToken } = await createChannel('Mem Perm Test');

    // Admin writes a memory entry
    const adminSession = await mcpInit(channel.id, adminToken);
    await mcpToolCall(channel.id, adminToken, adminSession.sessionId, 'memory_set', {
      key: 'test.key', value: 'test-value',
    });

    // Invite agent with memory_read only
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'reader',
      displayName: 'Reader',
      type: 'agent',
      permissions: ['memory_read', 'participants'],
    });
    const { sessionId } = await mcpInit(channel.id, invBody.token);

    // memory_get should work
    const { body: getBody } = await mcpToolCall(
      channel.id, invBody.token, sessionId, 'memory_get', { key: 'test.key' }
    );
    expect(getBody.result.isError).toBeUndefined();
    const entry = JSON.parse(getBody.result.content[0].text);
    expect(entry.value).toBe('test-value');

    // memory_set should be denied
    const { body: setBody } = await mcpToolCall(
      channel.id, invBody.token, sessionId, 'memory_set', { key: 'hack', value: 'nope' }
    );
    expect(setBody.result.isError).toBe(true);
    expect(setBody.result.content[0].text).toContain('Permission denied');
  });
});

// ─── MCP tool coverage ──────────────────────────────────────

describe('MCP tool coverage', () => {
  let channelId: string;
  let token: string;
  let sessionId: string;

  beforeAll(async () => {
    const { channel, adminToken } = await createChannel('Tool Coverage');
    channelId = channel.id;
    token = adminToken;
    const session = await mcpInit(channelId, token);
    sessionId = session.sessionId;
  });

  it('send_message and read_history', async () => {
    await mcpToolCall(channelId, token, sessionId, 'send_message', {
      content: 'coverage test',
    });
    const { body } = await mcpToolCall(channelId, token, sessionId, 'read_history', {});
    const msgs = JSON.parse(body.result.content[0].text);
    expect(msgs.some((m: { content: string }) => m.content === 'coverage test')).toBe(true);
  });

  it('read_conversation returns formatted text', async () => {
    const { body } = await mcpToolCall(channelId, token, sessionId, 'read_conversation', {});
    expect(body.result.content[0].text).toContain('coverage test');
    // Should have participant labels
    expect(body.result.content[0].text).toContain('[');
  });

  it('write_file, read_file, list_files', async () => {
    await mcpToolCall(channelId, token, sessionId, 'write_file', {
      path: 'test.txt', content: 'hello file',
    });
    const { body: readBody } = await mcpToolCall(channelId, token, sessionId, 'read_file', {
      path: 'test.txt',
    });
    expect(readBody.result.content[0].text).toBe('hello file');

    const { body: listBody } = await mcpToolCall(channelId, token, sessionId, 'list_files', {});
    const files = JSON.parse(listBody.result.content[0].text);
    expect(files.some((f: { name: string }) => f.name === 'test.txt')).toBe(true);
  });

  it('memory_set, memory_get, memory_list, memory_delete', async () => {
    await mcpToolCall(channelId, token, sessionId, 'memory_set', {
      key: 'cov.key', value: 'cov-value',
    });
    const { body: getBody } = await mcpToolCall(channelId, token, sessionId, 'memory_get', {
      key: 'cov.key',
    });
    const entry = JSON.parse(getBody.result.content[0].text);
    expect(entry.value).toBe('cov-value');

    const { body: listBody } = await mcpToolCall(channelId, token, sessionId, 'memory_list', {
      prefix: 'cov.',
    });
    const entries = JSON.parse(listBody.result.content[0].text);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const { body: delBody } = await mcpToolCall(channelId, token, sessionId, 'memory_delete', {
      key: 'cov.key',
    });
    expect(delBody.result.content[0].text).toBe('Deleted');
  });

  it('list_participants and whoami', async () => {
    const { body: listBody } = await mcpToolCall(channelId, token, sessionId, 'list_participants', {});
    const participants = JSON.parse(listBody.result.content[0].text);
    expect(participants.length).toBeGreaterThanOrEqual(1);

    const { body: whoBody } = await mcpToolCall(channelId, token, sessionId, 'whoami', {});
    const identity = JSON.parse(whoBody.result.content[0].text);
    expect(identity.channelId).toBe(channelId);
    expect(identity.permissions).toBeTruthy();
  });

  it('get_privacy_policy returns none when not set', async () => {
    const { body } = await mcpToolCall(channelId, token, sessionId, 'get_privacy_policy', {});
    expect(body.result.content[0].text).toContain('No privacy policy');
  });
});

// ─── Instructions / etiquette tests ──────────────────────────

describe('Instructions and etiquette', () => {
  it('includes participant roster in instructions', async () => {
    const { channel, adminToken } = await createChannel('Etiquette Test');
    await invite(channel.id, adminToken, {
      userId: 'bob', displayName: 'Bob', type: 'agent', agentName: 'gpt',
    });

    const { initBody } = await mcpInit(channel.id, adminToken);
    const instructions = initBody.result.instructions;
    expect(instructions).toContain('Admin');
    expect(instructions).toContain('Bob');
    expect(instructions).toContain('gpt');
  });

  it('includes privacy policy in instructions when set', async () => {
    const { channel, adminToken } = await createChannel('Privacy Instructions');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'priv', displayName: 'Priv',
      privacyPolicy: {
        instructions: 'Do not share financials',
        restrictedContext: ['salary data'],
      },
    });

    const { initBody } = await mcpInit(channel.id, invBody.token);
    const instructions = initBody.result.instructions;
    expect(instructions).toContain('Privacy boundaries');
    expect(instructions).toContain('Do not share financials');
    expect(instructions).toContain('salary data');
  });

  it('includes permission summary in instructions', async () => {
    const { channel, adminToken } = await createChannel('Perm Instructions');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'limited', displayName: 'Limited',
      permissions: ['messaging'],
    });

    const { initBody } = await mcpInit(channel.id, invBody.token);
    const instructions = initBody.result.instructions;
    expect(instructions).toContain('messaging');
    expect(instructions).toContain('denied');
  });

  it('new session gets updated roster', async () => {
    const { channel, adminToken } = await createChannel('Roster Update');

    // First session — only admin
    const { initBody: first } = await mcpInit(channel.id, adminToken);
    expect(first.result.instructions).toContain('Admin');
    expect(first.result.instructions).not.toContain('NewMember');

    // Add new member
    await invite(channel.id, adminToken, {
      userId: 'new', displayName: 'NewMember',
    });

    // New session — should see both
    const { initBody: second } = await mcpInit(channel.id, adminToken);
    expect(second.result.instructions).toContain('NewMember');
  });
});

// ─── Push broadcast tests ────────────────────────────────────

describe('Push broadcast', () => {
  it('broadcasts messages to other connected agents via SSE', async () => {
    const { channel, adminToken } = await createChannel('Broadcast Test');
    const { body: invBody } = await invite(channel.id, adminToken, {
      userId: 'listener', displayName: 'Listener Agent', type: 'agent', agentName: 'test',
    });

    const sender = await mcpInit(channel.id, adminToken);
    const listener = await mcpInit(channel.id, invBody.token);

    // Open SSE stream for listener
    const sseController = new AbortController();
    const ssePromise = fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${invBody.token}`,
        'mcp-session-id': listener.sessionId,
      },
      signal: sseController.signal,
    });

    await new Promise((r) => setTimeout(r, 50));

    // Sender sends a message
    await mcpToolCall(channel.id, adminToken, sender.sessionId, 'send_message', {
      content: 'Broadcast test message',
    });

    await new Promise((r) => setTimeout(r, 100));
    sseController.abort();

    try {
      const sseRes = await ssePromise;
      const sseText = await sseRes.text();
      expect(sseText).toContain('Broadcast test message');
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') throw e;
    }
  });

  it('does not broadcast back to sender', async () => {
    const { channel, adminToken } = await createChannel('No Self Broadcast');
    const sender = await mcpInit(channel.id, adminToken);

    // Open SSE for sender
    const sseController = new AbortController();
    const ssePromise = fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${adminToken}`,
        'mcp-session-id': sender.sessionId,
      },
      signal: sseController.signal,
    });

    await new Promise((r) => setTimeout(r, 50));

    await mcpToolCall(channel.id, adminToken, sender.sessionId, 'send_message', {
      content: 'Self message',
    });

    await new Promise((r) => setTimeout(r, 100));
    sseController.abort();

    try {
      const sseRes = await ssePromise;
      const sseText = await sseRes.text();
      // Should NOT contain the message since sender should be excluded
      expect(sseText).not.toContain('Self message');
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') throw e;
    }
  });
});

// ─── Error handling tests ────────────────────────────────────

describe('Error handling', () => {
  it('returns 404 for nonexistent channel MCP', async () => {
    const token = generateToken();
    const res = await fetch(`${baseUrl}/mcp/chan_nonexistent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.1.0' },
        },
      }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for nonexistent session ID', async () => {
    const { channel, adminToken } = await createChannel('Bad Session');
    const res = await fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${adminToken}`,
        'mcp-session-id': 'nonexistent-session',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing channel name', async () => {
    const res = await fetch(`${baseUrl}/api/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_ADMIN_KEY}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing invite fields', async () => {
    const { channel, adminToken } = await createChannel('Bad Invite');
    const res = await fetch(`${baseUrl}/api/channels/${channel.id}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ userId: 'missing-display-name' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for deleting nonexistent participant', async () => {
    const { channel, adminToken } = await createChannel('Del Nonexistent');
    const res = await fetch(
      `${baseUrl}/api/channels/${channel.id}/participants/nonexistent`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    expect(res.status).toBe(404);
  });

  it('returns 405 for unsupported HTTP method on MCP', async () => {
    const { channel, adminToken } = await createChannel('Method Test');
    const res = await fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(405);
  });
});
