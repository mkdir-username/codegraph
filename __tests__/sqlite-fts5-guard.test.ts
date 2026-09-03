/**
 * FTS5 availability guard at database open.
 *
 * `node:sqlite` only ships FTS5 from Node 22.16 onward, and the CLI floor is
 * not the only way in — the MCP server, the test suite and any library caller
 * construct a database directly. On an older runtime every search died with
 * `no such module: fts5`, a message that names neither the cause nor the fix.
 * The guard fires at open, where the version is the whole story.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDatabase } from '../src/db/sqlite-adapter';

const realNode = process.versions.node;

function pretendNode(version: string): void {
  Object.defineProperty(process.versions, 'node', { value: version, configurable: true });
}

describe('FTS5 guard on database open', () => {
  afterEach(() => {
    pretendNode(realNode);
  });

  it('refuses to open on a runtime whose node:sqlite has no FTS5', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-fts5-guard-'));
    pretendNode('22.14.0');

    try {
      expect(() => createDatabase(path.join(dir, 'test.db'))).toThrow(/FTS5/);
      expect(() => createDatabase(path.join(dir, 'test.db'))).toThrow(/22\.16/);
      expect(() => createDatabase(path.join(dir, 'test.db'))).toThrow(/22\.14\.0/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens normally on a supported runtime', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-fts5-guard-ok-'));
    try {
      const { db } = createDatabase(path.join(dir, 'test.db'));
      expect(db.open).toBe(true);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
