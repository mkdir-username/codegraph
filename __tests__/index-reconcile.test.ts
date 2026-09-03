/**
 * `indexAll()` reconciles deletions.
 *
 * A full re-index used to leave behind the row of a file deleted since the
 * previous run, so the graph kept answering with paths and symbols that no
 * longer existed — and the obvious recovery ("just re-index everything")
 * did not clear them, while the incremental `sync()` did. These cover the
 * counterintuitive half: after `indexAll()`, a file gone from disk is gone
 * from the index too.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import CodeGraph from '../src/index';

describe('indexAll deletion reconcile', () => {
  let testDir: string;
  let cg: CodeGraph;

  const paths = () => cg.getFiles().map((f) => f.path).sort();

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-index-reconcile-'));
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.writeFileSync(path.join(testDir, 'src', 'alive.ts'), 'export function alive() { return 1; }\n');
    fs.writeFileSync(path.join(testDir, 'src', 'doomed.ts'), 'export function doomed() { return 2; }\n');

    cg = CodeGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
  });

  afterEach(() => {
    try { cg.destroy(); } catch { /* ignore */ }
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('drops the row of a file deleted since the previous run', async () => {
    expect(paths()).toEqual(['src/alive.ts', 'src/doomed.ts']);

    fs.rmSync(path.join(testDir, 'src', 'doomed.ts'));
    await cg.indexAll();

    expect(paths()).toEqual(['src/alive.ts']);
  });

  it('drops the symbols of the deleted file, not just its row', async () => {
    fs.rmSync(path.join(testDir, 'src', 'doomed.ts'));
    await cg.indexAll();

    const hits = cg.searchNodes('doomed');
    expect(hits.map((h) => h.node.name)).not.toContain('doomed');
  });

  it('keeps the index intact when the scan comes back empty', async () => {
    // A scan that returns nothing is far more likely to be a broken scan than
    // a project that lost every source file — wiping the index on it would
    // turn a transient failure into a rebuild.
    fs.rmSync(path.join(testDir, 'src'), { recursive: true, force: true });
    await cg.indexAll();

    expect(paths()).toEqual(['src/alive.ts', 'src/doomed.ts']);
  });
});
