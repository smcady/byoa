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
});
