/**
 * Catch-up banner on MCP tool responses.
 *
 * The per-file staleness banner (issue #403) only fires on watcher events.
 * A reconcile started outside the watcher — `catchUpSync()` right after the
 * server opens, or any background `sync()` — leaves the pending set empty,
 * so responses served while the index is still catching up came back with
 * no marking at all: paths and symbols from the previous run, presented as
 * current. This covers the second signal, the in-flight index lock, which
 * `isIndexing()` already exposes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import CodeGraph from '../src/index';
import { ToolHandler, formatCatchUpBanner } from '../src/mcp/tools';

describe('MCP catch-up banner', () => {
  let testDir: string;
  let cg: CodeGraph;
  let handler: ToolHandler;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-catchup-banner-'));
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 1; }\n',
    );

    cg = CodeGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { cg.unwatch(); } catch { /* ignore */ }
    try { cg.close(); } catch { /* ignore */ }
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('names the risk and the recovery', () => {
    const banner = formatCatchUpBanner();
    expect(banner.startsWith('⚠️')).toBe(true);
    expect(banner).toMatch(/catching up/i);
    expect(banner).toMatch(/previous/i);
    expect(banner).toMatch(/again/i);
  });

  it('prepends the banner while the index is catching up', async () => {
    vi.spyOn(cg, 'isIndexing').mockReturnValue(true);

    const res = await handler.execute('codegraph_search', { query: 'alphaOnly' });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(true);
    expect(text).toMatch(/catching up/i);
    // The actual result must still follow the banner.
    expect(text).toMatch(/alphaOnly/);
  });

  it('stays silent once the catch-up finishes', async () => {
    const res = await handler.execute('codegraph_search', { query: 'alphaOnly' });
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(false);
    expect(text).not.toMatch(/catching up/i);
    expect(text).toMatch(/alphaOnly/);
  });

  it('leaves error results untouched', async () => {
    vi.spyOn(cg, 'isIndexing').mockReturnValue(true);

    // Missing `symbol` fails validation inside handleNode, so the error result
    // travels the same wrapper path a successful one does.
    const res = await handler.execute('codegraph_node', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text.startsWith('⚠️')).toBe(false);
  });
});
