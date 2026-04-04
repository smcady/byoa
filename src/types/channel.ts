export interface Channel {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
}

export interface Participant {
  id: string;
  channelId: string;
  userId: string;
  displayName: string;
  type: 'human' | 'agent';
  agentName?: string;
  tokenHash: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  participantId: string;
  type: 'text' | 'tool_result' | 'file_share' | 'system';
  content: string;
  metadata?: Record<string, string>;
  createdAt: string;
}

export interface MemoryEntry {
  channelId: string;
  key: string;
  value: string;
  setBy: string;
  updatedAt: string;
}
