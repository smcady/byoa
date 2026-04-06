/**
 * In-memory ring buffer that captures console.log/error output
 * and exposes it via an HTTP endpoint for remote debugging.
 */

const MAX_LINES = 200;
const lines: string[] = [];

const originalLog = console.log;
const originalError = console.error;

export function installLogBuffer(): void {
  console.log = (...args: unknown[]) => {
    const line = `[LOG] ${args.map(String).join(' ')}`;
    lines.push(line);
    if (lines.length > MAX_LINES) lines.shift();
    originalLog(...args);
  };

  console.error = (...args: unknown[]) => {
    const line = `[ERR] ${args.map(String).join(' ')}`;
    lines.push(line);
    if (lines.length > MAX_LINES) lines.shift();
    originalError(...args);
  };
}

export function getLogLines(filter?: string): string[] {
  if (!filter) return [...lines];
  return lines.filter((l) => l.includes(filter));
}
