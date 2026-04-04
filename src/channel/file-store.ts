import fs from 'node:fs';
import path from 'node:path';
import { ValidationError, NotFoundError } from '../types/errors.js';

export class FileStore {
  constructor(private filesDir: string) {
    fs.mkdirSync(this.filesDir, { recursive: true });
  }

  write(filePath: string, content: string): void {
    const resolved = this.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
  }

  read(filePath: string): string {
    const resolved = this.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new NotFoundError(`File: ${filePath}`);
    return fs.readFileSync(resolved, 'utf-8');
  }

  list(dirPath: string = '.'): Array<{ name: string; type: 'file' | 'directory' }> {
    const resolved = this.resolve(dirPath);
    if (!fs.existsSync(resolved)) return [];
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' as const : 'file' as const,
    }));
  }

  delete(filePath: string): boolean {
    const resolved = this.resolve(filePath);
    if (!fs.existsSync(resolved)) return false;
    fs.unlinkSync(resolved);
    return true;
  }

  private resolve(filePath: string): string {
    const resolved = path.resolve(this.filesDir, filePath);
    if (!resolved.startsWith(this.filesDir)) {
      throw new ValidationError('Path traversal not allowed');
    }
    return resolved;
  }
}
