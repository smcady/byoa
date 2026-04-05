import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ChannelManager } from '../src/channel/channel-manager.js';

let manager: ChannelManager;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-mgr-test-'));
  manager = new ChannelManager(tmpDir);
});

afterEach(() => {
  manager.closeAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ChannelManager', () => {
  it('creates a channel with correct ID prefix', () => {
    const { channel } = manager.create('Test Channel', 'admin');
    expect(channel.id).toMatch(/^chan_/);
    expect(channel.name).toBe('Test Channel');
    expect(channel.createdBy).toBe('admin');
  });

  it('returns the store on create', () => {
    const { store } = manager.create('Test', 'admin');
    expect(store).toBeTruthy();
    expect(store.channelId).toMatch(/^chan_/);
  });

  it('loads an existing channel', () => {
    const { channel } = manager.create('Persistent', 'admin');
    // Add data to verify it persists
    const { store } = manager.create('Persistent 2', 'admin');

    const loaded = manager.getOrLoad(channel.id);
    expect(loaded.channelId).toBe(channel.id);
  });

  it('lists all channels', () => {
    manager.create('Chan A', 'admin');
    manager.create('Chan B', 'admin');
    const channels = manager.list();
    expect(channels).toHaveLength(2);
    expect(channels.map((c) => c.name).sort()).toEqual(['Chan A', 'Chan B']);
  });

  it('throws on loading nonexistent channel', () => {
    expect(() => manager.getOrLoad('chan_nonexistent')).toThrow('Channel: chan_nonexistent');
  });

  it('persists channels across manager instances', () => {
    const { channel } = manager.create('Durable', 'admin');
    const store = manager.getOrLoad(channel.id);
    store.addMessage('p1', 'persisted message');
    manager.closeAll();

    // New manager instance
    const manager2 = new ChannelManager(tmpDir);
    const reloaded = manager2.getOrLoad(channel.id);
    const messages = reloaded.messages.list();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('persisted message');
    manager2.closeAll();
  });

  it('lists channels after restart', () => {
    manager.create('Survive Restart', 'admin');
    manager.closeAll();

    const manager2 = new ChannelManager(tmpDir);
    const channels = manager2.list();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('Survive Restart');
    manager2.closeAll();
  });

  it('closeAll clears all stores', () => {
    const { channel } = manager.create('Close Test', 'admin');
    manager.closeAll();
    // After close, getOrLoad should reload from disk
    manager = new ChannelManager(tmpDir);
    const reloaded = manager.getOrLoad(channel.id);
    expect(reloaded.channelId).toBe(channel.id);
  });
});
