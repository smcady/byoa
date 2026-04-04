import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'node:http';
import { ChannelManager } from '../src/channel/channel-manager.js';
import { createApp } from '../src/server/http-server.js';
import { generateToken, hashToken } from '../src/auth/tokens.js';

let server: Server;
let baseUrl: string;
let tmpDir: string;
let channelManager: ChannelManager;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-int-test-'));
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
  channelManager.closeAll();
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Admin API', () => {
  it('creates a channel and returns admin token', async () => {
    const res = await fetch(`${baseUrl}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Integration Test' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.channel.name).toBe('Integration Test');
    expect(body.adminToken).toMatch(/^agora_tok_/);
    expect(body.mcpEndpoint).toMatch(/^\/mcp\/chan_/);
  });

  it('invites a participant and returns MCP config', async () => {
    // Create channel
    const createRes = await fetch(`${baseUrl}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Invite Test' }),
    });
    const { channel, adminToken } = await createRes.json();

    // Invite agent
    const inviteRes = await fetch(`${baseUrl}/api/channels/${channel.id}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        userId: 'alice',
        displayName: "Alice's Claude",
        type: 'agent',
        agentName: 'claude-code',
      }),
    });
    expect(inviteRes.status).toBe(201);
    const body = await inviteRes.json();
    expect(body.participant.displayName).toBe("Alice's Claude");
    expect(body.token).toMatch(/^agora_tok_/);
    expect(body.mcpConfig.type).toBe('streamableHttp');
  });

  it('lists channels', async () => {
    const res = await fetch(`${baseUrl}/api/channels`);
    const body = await res.json();
    expect(body.channels.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects unauthenticated invites', async () => {
    const createRes = await fetch(`${baseUrl}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auth Test' }),
    });
    const { channel } = await createRes.json();

    const inviteRes = await fetch(`${baseUrl}/api/channels/${channel.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'bob', displayName: 'Bob' }),
    });
    expect(inviteRes.status).toBe(401);
  });
});

describe('MCP endpoint', () => {
  it('initializes an MCP session for authenticated agent', async () => {
    // Setup: create channel + agent
    const createRes = await fetch(`${baseUrl}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MCP Test' }),
    });
    const { channel, adminToken } = await createRes.json();

    // MCP initialize request
    const initRes = await fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${adminToken}`,
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

    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();

    const body = await initRes.json();
    expect(body.result.serverInfo.name).toMatch(/^agora-/);
  });

  it('rejects unauthenticated MCP requests', async () => {
    const createRes = await fetch(`${baseUrl}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auth MCP Test' }),
    });
    const { channel } = await createRes.json();

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
    // Create channel
    const createRes = await fetch(`${baseUrl}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Collab Test' }),
    });
    const { channel, adminToken } = await createRes.json();

    // Create second agent
    const inviteRes = await fetch(`${baseUrl}/api/channels/${channel.id}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        userId: 'bob',
        displayName: "Bob's Agent",
        type: 'agent',
        agentName: 'gpt',
      }),
    });
    const { token: bobToken } = await inviteRes.json();

    // Helper: do MCP request cycle
    async function mcpSession(token: string) {
      const initRes = await fetch(`${baseUrl}/mcp/${channel.id}`, {
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
      const sessionId = initRes.headers.get('mcp-session-id')!;

      // Send initialized notification
      await fetch(`${baseUrl}/mcp/${channel.id}`, {
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

      return { sessionId, token };
    }

    // Initialize both agents
    const agentA = await mcpSession(adminToken);
    const agentB = await mcpSession(bobToken);

    // Agent A sends a message
    const sendRes = await fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${adminToken}`,
        'mcp-session-id': agentA.sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'send_message',
          arguments: { content: 'Hello from Agent A!' },
        },
      }),
    });
    expect(sendRes.status).toBe(200);

    // Agent B reads history
    const readRes = await fetch(`${baseUrl}/mcp/${channel.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${bobToken}`,
        'mcp-session-id': agentB.sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'read_history',
          arguments: {},
        },
      }),
    });
    expect(readRes.status).toBe(200);
    const readBody = await readRes.json();
    const messages = JSON.parse(readBody.result.content[0].text);
    expect(messages.some((m: { content: string }) => m.content === 'Hello from Agent A!')).toBe(true);
  });
});
