import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ChannelStore } from '../src/channel/channel-store.js';
import { hashToken } from '../src/auth/tokens.js';

let store: ChannelStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-test-'));
  store = new ChannelStore('test-channel', tmpDir);
});

afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MessageStore', () => {
  it('adds and retrieves messages', () => {
    const msg = store.addMessage('p1', 'Hello world');
    expect(msg.content).toBe('Hello world');
    expect(msg.participantId).toBe('p1');
    expect(msg.type).toBe('text');
    expect(msg.id).toBeTruthy();

    const history = store.messages.list();
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('Hello world');
  });

  it('supports cursor-based pagination', () => {
    store.addMessage('p1', 'msg1');
    const msg2 = store.addMessage('p1', 'msg2');
    store.addMessage('p1', 'msg3');

    const after = store.messages.list({ after: msg2.id });
    expect(after).toHaveLength(1);
    expect(after[0].content).toBe('msg3');

    const before = store.messages.list({ before: msg2.id });
    expect(before).toHaveLength(1);
    expect(before[0].content).toBe('msg1');
  });

  it('emits message:new on addMessage', () => {
    let emitted = false;
    store.on('message:new', () => { emitted = true; });
    store.addMessage('p1', 'test');
    expect(emitted).toBe(true);
  });

  it('stores metadata', () => {
    const msg = store.addMessage('p1', 'reply', 'text', { replyTo: 'msg123' });
    expect(msg.metadata).toEqual({ replyTo: 'msg123' });

    const retrieved = store.messages.getById(msg.id);
    expect(retrieved?.metadata).toEqual({ replyTo: 'msg123' });
  });

  it('returns empty list from empty channel', () => {
    expect(store.messages.list()).toHaveLength(0);
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) store.addMessage('p1', `msg${i}`);
    const limited = store.messages.list({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('handles cursor pointing to nonexistent message', () => {
    store.addMessage('p1', 'msg1');
    // Nonexistent cursor should return empty (rowid subquery returns null)
    const result = store.messages.list({ before: 'nonexistent-id' });
    expect(result).toHaveLength(0);
  });

  it('enriches emitted message with participant identity', () => {
    store.participants.add({
      userId: 'u1',
      displayName: 'Alice',
      type: 'human',
      tokenHash: 'h1',
    });
    const participants = store.participants.list();
    const pid = participants[0].id;

    let emittedMsg: any;
    store.on('message:new', (msg) => { emittedMsg = msg; });
    store.addMessage(pid, 'Hello');

    expect(emittedMsg.displayName).toBe('Alice');
    expect(emittedMsg.participantType).toBe('human');
  });

  it('formats conversation with listFormatted', () => {
    const p = store.participants.add({
      userId: 'u1',
      displayName: 'Alice',
      type: 'agent',
      agentName: 'claude',
      tokenHash: 'h1',
    });
    store.addMessage(p.id, 'Hello from Alice');

    const formatted = store.messages.listFormatted();
    expect(formatted).toContain('[Alice [agent, claude]]');
    expect(formatted).toContain('Hello from Alice');
  });

  it('listFormatted returns placeholder for empty channel', () => {
    expect(store.messages.listFormatted()).toBe('(no messages yet)');
  });

  it('handles many messages with pagination', () => {
    for (let i = 0; i < 100; i++) store.addMessage('p1', `msg-${i}`);
    const all = store.messages.list({ limit: 200 });
    expect(all).toHaveLength(100);

    // Get last 10
    const page = store.messages.list({ limit: 10 });
    expect(page).toHaveLength(10);
    // Should be the most recent 10 (ordered by rowid desc, returned reversed)
    expect(page[0].content).toBe('msg-90');
    expect(page[9].content).toBe('msg-99');
  });
});

describe('MemoryStore', () => {
  it('sets and gets values', () => {
    store.memory.set('project.status', 'active', 'p1');
    const entry = store.memory.get('project.status');
    expect(entry?.value).toBe('active');
    expect(entry?.setBy).toBe('p1');
  });

  it('upserts on duplicate key', () => {
    store.memory.set('key', 'v1', 'p1');
    store.memory.set('key', 'v2', 'p2');
    const entry = store.memory.get('key');
    expect(entry?.value).toBe('v2');
    expect(entry?.setBy).toBe('p2');
  });

  it('lists with prefix filter', () => {
    store.memory.set('project.name', 'Agora', 'p1');
    store.memory.set('project.status', 'active', 'p1');
    store.memory.set('decision.auth', 'bearer tokens', 'p1');

    const projectEntries = store.memory.list('project.');
    expect(projectEntries).toHaveLength(2);

    const all = store.memory.list();
    expect(all).toHaveLength(3);
  });

  it('deletes keys', () => {
    store.memory.set('temp', 'value', 'p1');
    expect(store.memory.delete('temp')).toBe(true);
    expect(store.memory.get('temp')).toBeUndefined();
    expect(store.memory.delete('nonexistent')).toBe(false);
  });

  it('handles special characters in keys', () => {
    store.memory.set('key/with/slashes', 'val1', 'p1');
    store.memory.set('key.with.dots', 'val2', 'p1');
    store.memory.set('key with spaces', 'val3', 'p1');

    expect(store.memory.get('key/with/slashes')?.value).toBe('val1');
    expect(store.memory.get('key.with.dots')?.value).toBe('val2');
    expect(store.memory.get('key with spaces')?.value).toBe('val3');
  });

  it('handles large values', () => {
    const largeValue = 'x'.repeat(100_000);
    store.memory.set('big', largeValue, 'p1');
    expect(store.memory.get('big')?.value).toBe(largeValue);
  });

  it('returns undefined for nonexistent key', () => {
    expect(store.memory.get('nope')).toBeUndefined();
  });
});

describe('FileStore', () => {
  it('writes and reads files', () => {
    store.files.write('notes.txt', 'Hello');
    expect(store.files.read('notes.txt')).toBe('Hello');
  });

  it('creates nested directories', () => {
    store.files.write('docs/design/spec.md', '# Spec');
    expect(store.files.read('docs/design/spec.md')).toBe('# Spec');
  });

  it('lists files', () => {
    store.files.write('a.txt', 'a');
    store.files.write('b.txt', 'b');
    const entries = store.files.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('blocks path traversal', () => {
    expect(() => store.files.write('../escape.txt', 'bad')).toThrow('Path traversal');
  });

  it('encoded path sequences stay within sandbox', () => {
    // %2F is treated literally by path.resolve, so it doesn't escape
    store.files.write('..%2F..%2Fetc/passwd', 'safe');
    expect(store.files.read('..%2F..%2Fetc/passwd')).toBe('safe');
  });

  it('overwrites existing files', () => {
    store.files.write('file.txt', 'v1');
    store.files.write('file.txt', 'v2');
    expect(store.files.read('file.txt')).toBe('v2');
  });

  it('throws on reading nonexistent file', () => {
    expect(() => store.files.read('nope.txt')).toThrow('File: nope.txt');
  });

  it('lists empty directory', () => {
    expect(store.files.list()).toHaveLength(0);
  });

  it('lists nonexistent subdirectory', () => {
    expect(store.files.list('nonexistent')).toHaveLength(0);
  });

  it('lists directories in output', () => {
    store.files.write('subdir/file.txt', 'content');
    const entries = store.files.list();
    expect(entries.some((e) => e.name === 'subdir' && e.type === 'directory')).toBe(true);
  });

  it('deletes files', () => {
    store.files.write('temp.txt', 'tmp');
    expect(store.files.delete('temp.txt')).toBe(true);
    expect(store.files.delete('temp.txt')).toBe(false);
  });
});

describe('ParticipantStore', () => {
  it('adds and finds by token hash', () => {
    const hash = hashToken('test-token');
    const p = store.participants.add({
      userId: 'user1',
      displayName: 'Alice',
      type: 'human',
      tokenHash: hash,
    });
    expect(p.displayName).toBe('Alice');

    const found = store.participants.findByTokenHash(hash);
    expect(found?.id).toBe(p.id);
  });

  it('lists all participants', () => {
    store.participants.add({ userId: 'u1', displayName: 'A', type: 'human', tokenHash: 'h1' });
    store.participants.add({ userId: 'u2', displayName: 'B', type: 'agent', agentName: 'claude', tokenHash: 'h2' });
    const list = store.participants.list();
    expect(list).toHaveLength(2);
  });

  it('removes participants', () => {
    const p = store.participants.add({ userId: 'u1', displayName: 'A', type: 'human', tokenHash: 'h1' });
    expect(store.participants.remove(p.id)).toBe(true);
    expect(store.participants.list()).toHaveLength(0);
  });

  it('defaults to all permissions', () => {
    const p = store.participants.add({
      userId: 'u1',
      displayName: 'A',
      type: 'human',
      tokenHash: 'h1',
    });
    expect(p.permissions).toEqual([
      'messaging', 'files_read', 'files_write', 'memory_read', 'memory_write', 'participants',
    ]);
  });

  it('accepts custom permissions on add', () => {
    const p = store.participants.add({
      userId: 'u1',
      displayName: 'A',
      type: 'agent',
      permissions: ['messaging', 'participants'],
      tokenHash: 'h1',
    });
    expect(p.permissions).toEqual(['messaging', 'participants']);

    // Verify persisted
    const found = store.participants.findByTokenHash('h1');
    expect(found?.permissions).toEqual(['messaging', 'participants']);
  });

  it('updates permissions', () => {
    const p = store.participants.add({
      userId: 'u1',
      displayName: 'A',
      type: 'agent',
      tokenHash: 'h1',
    });
    store.participants.updatePermissions(p.id, ['messaging']);
    const updated = store.participants.getById(p.id);
    expect(updated?.permissions).toEqual(['messaging']);
  });

  it('stores and retrieves privacy policy', () => {
    const policy = {
      shareableContext: ['project status'],
      restrictedContext: ['financials'],
      instructions: 'Keep it secret',
    };
    const p = store.participants.add({
      userId: 'u1',
      displayName: 'A',
      type: 'agent',
      privacyPolicy: policy,
      tokenHash: 'h1',
    });
    expect(p.privacyPolicy).toEqual(policy);

    const found = store.participants.getById(p.id);
    expect(found?.privacyPolicy).toEqual(policy);
  });

  it('updates privacy policy', () => {
    const p = store.participants.add({
      userId: 'u1',
      displayName: 'A',
      type: 'agent',
      tokenHash: 'h1',
    });
    expect(p.privacyPolicy).toBeUndefined();

    store.participants.updatePrivacyPolicy(p.id, { instructions: 'Be careful' });
    const updated = store.participants.getById(p.id);
    expect(updated?.privacyPolicy?.instructions).toBe('Be careful');

    store.participants.updatePrivacyPolicy(p.id, null);
    const cleared = store.participants.getById(p.id);
    expect(cleared?.privacyPolicy).toBeUndefined();
  });

  it('returns undefined for nonexistent participant', () => {
    expect(store.participants.getById('nope')).toBeUndefined();
    expect(store.participants.findByTokenHash('nope')).toBeUndefined();
  });

  it('remove returns false for nonexistent participant', () => {
    expect(store.participants.remove('nope')).toBe(false);
  });

  it('updateLastSeen updates timestamp', () => {
    const p = store.participants.add({
      userId: 'u1',
      displayName: 'A',
      type: 'human',
      tokenHash: 'h1',
    });
    const before = p.lastSeenAt;
    // Small delay to ensure timestamp differs
    store.participants.updateLastSeen(p.id);
    const updated = store.participants.getById(p.id);
    expect(updated?.lastSeenAt).toBeTruthy();
  });
});
