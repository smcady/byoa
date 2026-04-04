import type { ChannelManager } from '../channel/channel-manager.js';
import type { Participant } from '../types/channel.js';
import { AuthError } from '../types/errors.js';
import { hashToken } from './tokens.js';

export function authenticateRequest(
  channelManager: ChannelManager,
  channelId: string,
  authHeader: string | undefined
): Participant {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);
  const store = channelManager.getOrLoad(channelId);
  const participant = store.participants.findByTokenHash(tokenHash);
  if (!participant) {
    throw new AuthError('Invalid token');
  }
  store.participants.updateLastSeen(participant.id);
  return participant;
}
