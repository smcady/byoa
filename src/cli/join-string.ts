/**
 * Encodes/decodes a join string that contains everything needed
 * to connect an agent to a channel: server URL, channel ID, and token.
 *
 * Format: base64url-encoded JSON with short keys for compactness.
 */

interface JoinPayload {
  s: string; // server URL
  c: string; // channel ID
  t: string; // token
}

export function encodeJoinString(serverUrl: string, channelId: string, token: string): string {
  const payload: JoinPayload = { s: serverUrl, c: channelId, t: token };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeJoinString(blob: string): {
  serverUrl: string;
  channelId: string;
  token: string;
} {
  let parsed: JoinPayload;
  try {
    const json = Buffer.from(blob, 'base64url').toString('utf-8');
    parsed = JSON.parse(json);
  } catch {
    throw new Error(
      'Invalid join string. Make sure you copied the entire string from the invite output.'
    );
  }

  if (!parsed.s || !parsed.c || !parsed.t) {
    throw new Error('Malformed join string — missing server, channel, or token.');
  }
  if (!parsed.c.startsWith('chan_')) {
    throw new Error('Malformed join string — invalid channel ID.');
  }
  if (!parsed.t.startsWith('agora_tok_')) {
    throw new Error('Malformed join string — invalid token.');
  }

  return { serverUrl: parsed.s, channelId: parsed.c, token: parsed.t };
}

/**
 * Detect whether a string is the legacy format (channelId:token) or a base64 join string.
 */
export function isLegacyFormat(input: string): boolean {
  return input.includes(':agora_tok_');
}
