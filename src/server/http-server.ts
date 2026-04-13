import express from 'express';
import crypto from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ChannelManager } from '../channel/channel-manager.js';
import { SessionManager } from './session-manager.js';
import { createChannelMcpServer } from './mcp-factory.js';
import { authenticateRequest } from '../auth/token-auth.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import { AgoraError, AuthError, ForbiddenError, NotFoundError, ValidationError } from '../types/errors.js';
import { ALL_PERMISSIONS } from '../types/channel.js';
import type { Participant, Permission, PrivacyPolicy } from '../types/channel.js';

export function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const adminKey = process.env.AGORA_ADMIN_KEY;
  if (!adminKey) {
    res.status(403).json({ error: 'Admin endpoints are disabled. Set AGORA_ADMIN_KEY environment variable to enable.' });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${adminKey}`) {
    res.status(401).json({ error: 'Invalid or missing admin API key' });
    return;
  }
  next();
}

export function createApp(channelManager: ChannelManager) {
  const app = express();
  const sessionManager = new SessionManager();

  app.use(express.json());

  // Track which channels have message broadcast wired up
  const wiredChannels = new Set<string>();

  function ensureBroadcastWired(channelId: string): void {
    if (wiredChannels.has(channelId)) return;
    const store = channelManager.getOrLoad(channelId);
    store.on('message:new', (message) => {
      sessionManager.broadcastMessage(channelId, message, message.participantId);
    });
    wiredChannels.add(channelId);
  }

  function requireManagePermission(participant: Participant): void {
    if (!participant.permissions.includes('manage')) {
      throw new ForbiddenError('This action requires the "manage" permission');
    }
  }

  // ─── MCP endpoint ──────────────────────────────────────────────
  // Handles POST (messages), GET (SSE stream), and DELETE (session close)

  app.all('/mcp/:channelId', async (req, res) => {
    const { channelId } = req.params;

    try {
      // Auth: resolve bearer token to participant
      const participant = authenticateRequest(
        channelManager,
        channelId,
        req.headers.authorization
      );
      const store = channelManager.getOrLoad(channelId);

      if (req.method === 'POST') {
        // Check if this is an existing session
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId) {
          // Existing session — route to its transport
          const session = sessionManager.get(sessionId);
          if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
          }
          // Bind session to originating token — prevent session hijacking
          if (session.participant.id !== participant.id) {
            res.status(403).json({ error: 'Session does not belong to this token' });
            return;
          }
          sessionManager.touch(sessionId);
          await session.transport.handleRequest(req, res, req.body);
          return;
        }

        // New session — create transport, server, and connect
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (newSessionId: string) => {
            sessionManager.register(newSessionId, {
              transport,
              server: mcpServer,
              participant,
              channelId,
              lastActivity: Date.now(),
            });
          },
          onsessionclosed: (closedSessionId: string) => {
            sessionManager.remove(closedSessionId);
          },
        });

        const mcpServer = createChannelMcpServer(store, participant);
        await mcpServer.connect(transport);
        ensureBroadcastWired(channelId);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === 'GET') {
        // SSE stream for an existing session
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId) {
          res.status(400).json({ error: 'Missing mcp-session-id header' });
          return;
        }
        const session = sessionManager.get(sessionId);
        if (!session) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }
        if (session.participant.id !== participant.id) {
          res.status(403).json({ error: 'Session does not belong to this token' });
          return;
        }
        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId) {
          res.status(400).json({ error: 'Missing mcp-session-id header' });
          return;
        }
        const session = sessionManager.get(sessionId);
        if (!session) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }
        if (session.participant.id !== participant.id) {
          res.status(403).json({ error: 'Session does not belong to this token' });
          return;
        }
        await session.transport.handleRequest(req, res);
        return;
      }

      res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ─── Admin API ─────────────────────────────────────────────────

  // Create channel
  app.post('/api/channels', requireAdminAuth, (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        throw new ValidationError('Channel name is required');
      }

      const adminToken = generateToken();
      const { channel, store } = channelManager.create(name, 'admin');

      // Create admin participant with manage permission
      store.participants.add({
        userId: 'admin',
        displayName: 'Admin',
        type: 'human',
        permissions: ALL_PERMISSIONS,
        tokenHash: hashToken(adminToken),
      });

      res.status(201).json({
        channel,
        adminToken,
        mcpEndpoint: `/mcp/${channel.id}`,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // List channels
  app.get('/api/channels', requireAdminAuth, (_req, res) => {
    try {
      const channels = channelManager.list();
      res.json({ channels });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Invite user to channel (creates participant + token)
  app.post('/api/channels/:channelId/invite', (req, res) => {
    try {
      const { channelId } = req.params;
      const { userId, displayName, type, agentName, permissions, privacyPolicy } = req.body;

      if (!userId || !displayName) {
        throw new ValidationError('userId and displayName are required');
      }

      // Validate permissions if provided
      let validatedPermissions: Permission[] | undefined;
      if (permissions) {
        if (!Array.isArray(permissions)) {
          throw new ValidationError('permissions must be an array');
        }
        for (const p of permissions) {
          if (!ALL_PERMISSIONS.includes(p)) {
            throw new ValidationError(`Invalid permission: ${p}. Valid: ${ALL_PERMISSIONS.join(', ')}`);
          }
        }
        validatedPermissions = permissions;
      }

      // Auth: only participants with manage permission can invite
      const caller = authenticateRequest(channelManager, channelId, req.headers.authorization);
      requireManagePermission(caller);

      // Validate privacy policy if provided
      if (privacyPolicy && typeof privacyPolicy !== 'object') {
        throw new ValidationError('privacyPolicy must be an object');
      }

      const store = channelManager.getOrLoad(channelId);
      const token = generateToken();
      const participant = store.participants.add({
        userId,
        displayName,
        type: type || 'human',
        agentName,
        permissions: validatedPermissions,
        privacyPolicy: privacyPolicy as PrivacyPolicy | undefined,
        tokenHash: hashToken(token),
      });

      res.status(201).json({
        participant: {
          id: participant.id,
          userId: participant.userId,
          displayName: participant.displayName,
          type: participant.type,
          agentName: participant.agentName,
          permissions: participant.permissions,
        },
        token,
        mcpConfig: {
          type: 'streamableHttp',
          url: `${process.env.AGORA_BASE_URL ?? `http://localhost:${process.env.PORT ?? process.env.AGORA_PORT ?? 3737}`}/mcp/${channelId}`,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // List participants in a channel
  app.get('/api/channels/:channelId/participants', (req, res) => {
    try {
      const { channelId } = req.params;
      authenticateRequest(channelManager, channelId, req.headers.authorization);
      const store = channelManager.getOrLoad(channelId);
      const participants = store.participants.list().map((p) => ({
        id: p.id,
        userId: p.userId,
        displayName: p.displayName,
        type: p.type,
        agentName: p.agentName,
        joinedAt: p.joinedAt,
        lastSeenAt: p.lastSeenAt,
      }));
      res.json({ participants });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Update participant permissions
  app.patch('/api/channels/:channelId/participants/:participantId/permissions', (req, res) => {
    try {
      const { channelId, participantId } = req.params;
      const { permissions } = req.body;

      if (!Array.isArray(permissions)) {
        throw new ValidationError('permissions must be an array');
      }
      for (const p of permissions) {
        if (!ALL_PERMISSIONS.includes(p)) {
          throw new ValidationError(`Invalid permission: ${p}. Valid: ${ALL_PERMISSIONS.join(', ')}`);
        }
      }

      const caller = authenticateRequest(channelManager, channelId, req.headers.authorization);
      requireManagePermission(caller);
      const store = channelManager.getOrLoad(channelId);
      const updated = store.participants.updatePermissions(participantId, permissions);
      if (!updated) throw new NotFoundError(`Participant: ${participantId}`);

      const participant = store.participants.getById(participantId);
      res.json({
        id: participant!.id,
        displayName: participant!.displayName,
        permissions: participant!.permissions,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Update participant privacy policy
  app.patch('/api/channels/:channelId/participants/:participantId/privacy', (req, res) => {
    try {
      const { channelId, participantId } = req.params;
      const { privacyPolicy } = req.body;

      if (privacyPolicy !== null && typeof privacyPolicy !== 'object') {
        throw new ValidationError('privacyPolicy must be an object or null');
      }

      const caller = authenticateRequest(channelManager, channelId, req.headers.authorization);
      requireManagePermission(caller);
      const store = channelManager.getOrLoad(channelId);
      const updated = store.participants.updatePrivacyPolicy(
        participantId,
        privacyPolicy as PrivacyPolicy | null
      );
      if (!updated) throw new NotFoundError(`Participant: ${participantId}`);

      const participant = store.participants.getById(participantId);
      res.json({
        id: participant!.id,
        displayName: participant!.displayName,
        privacyPolicy: participant!.privacyPolicy ?? null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Remove participant
  app.delete('/api/channels/:channelId/participants/:participantId', (req, res) => {
    try {
      const { channelId, participantId } = req.params;
      const caller = authenticateRequest(channelManager, channelId, req.headers.authorization);
      requireManagePermission(caller);
      const store = channelManager.getOrLoad(channelId);
      const removed = store.participants.remove(participantId);
      if (!removed) throw new NotFoundError(`Participant: ${participantId}`);
      res.json({ removed: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // Diagnostic endpoint for Telegram adapter and general status
  app.get('/api/diagnostics', requireAdminAuth, (_req, res) => {
    const channels = channelManager.list();
    const sessionsDetail = sessionManager.listAll().map((s) => ({
      channelId: s.channelId,
      participant: s.participant.displayName,
      participantId: s.participant.id,
      type: s.participant.type,
    }));
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      channels: channels.length,
      activeSessions: sessionsDetail.length,
      sessions: sessionsDetail,
    });
  });

  return { app, sessionManager };
}

function handleError(res: express.Response, err: unknown): void {
  if (err instanceof AgoraError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
  } else {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
