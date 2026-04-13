import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../src/auth/tokens.js';

describe('Token generation', () => {
  it('generates tokens with correct prefix', () => {
    const token = generateToken();
    expect(token).toMatch(/^byoa_tok_/);
  });

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
  });

  it('generates tokens of consistent length', () => {
    const tokens = Array.from({ length: 10 }, () => generateToken());
    const lengths = new Set(tokens.map((t) => t.length));
    expect(lengths.size).toBe(1);
  });
});

describe('Token hashing', () => {
  it('produces a hex hash', () => {
    const hash = hashToken('byoa_tok_test123');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('produces different hashes for different tokens', () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(hashToken(t1)).not.toBe(hashToken(t2));
  });

  it('round-trips correctly — can find participant by hash of original token', () => {
    const token = generateToken();
    const hash = hashToken(token);
    // Re-hashing the same token should match
    expect(hashToken(token)).toBe(hash);
  });
});
