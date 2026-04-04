export interface Channel {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
}

export type Permission =
  | 'messaging'
  | 'files_read'
  | 'files_write'
  | 'memory_read'
  | 'memory_write'
  | 'participants';

export const ALL_PERMISSIONS: Permission[] = [
  'messaging',
  'files_read',
  'files_write',
  'memory_read',
  'memory_write',
  'participants',
];

export const TOOL_PERMISSION_MAP: Record<string, Permission> = {
  send_message: 'messaging',
  read_history: 'messaging',
  read_conversation: 'messaging',
  read_file: 'files_read',
  list_files: 'files_read',
  write_file: 'files_write',
  memory_get: 'memory_read',
  memory_list: 'memory_read',
  memory_set: 'memory_write',
  memory_delete: 'memory_write',
  list_participants: 'participants',
  whoami: 'participants',
  get_privacy_policy: 'participants',
};

export interface PrivacyPolicy {
  shareableContext?: string[];
  restrictedContext?: string[];
  instructions?: string;
}

export interface Participant {
  id: string;
  channelId: string;
  userId: string;
  displayName: string;
  type: 'human' | 'agent';
  agentName?: string;
  permissions: Permission[];
  privacyPolicy?: PrivacyPolicy;
  tokenHash: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  participantId: string;
  displayName?: string;
  participantType?: 'human' | 'agent';
  agentName?: string;
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
