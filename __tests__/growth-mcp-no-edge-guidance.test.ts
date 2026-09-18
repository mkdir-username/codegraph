/**
 * Growth backlog — `callers`/`callees` dead ends.
 *
 * Measured across 507 local agent transcripts, `codegraph_callers` failed on
 * 54% of its calls, and every miss answered with a bare
 * `No callers found for "X"` — a dead end the agent left for Read/Grep.
 * An empty edge set is an ANSWER: say the symbol is indexed, why nothing
 * points at it, and which codegraph call continues the investigation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ToolHandler, buildNoEdgeGuidance } from '../src/mcp/tools';
import CodeGraph from '../src/index';
import type { Node } from '../src/types';

function fakeNode(name: string, file: string, line: number): Node {
  return {
    id: `${file}:${name}`,
    name,
    kind: 'function',
    filePath: file,
    startLine: line,
    endLine: line + 2,
  } as Node;
}

describe('buildNoEdgeGuidance — an empty edge set answers instead of dead-ending', () => {
  const nodes = [fakeNode('orphan', 'src/a.ts', 12)];

  it('names the definition site so the agent does not go looking for it', () => {
    const text = buildNoEdgeGuidance('orphan', nodes, 'callers');
    expect(text).toContain('src/a.ts:12');
    expect(text).toContain('orphan');
  });

  it('gives the reasons an indexed symbol can have no callers', () => {
    const text = buildNoEdgeGuidance('orphan', nodes, 'callers');
    expect(text).toMatch(/entry point/i);
    expect(text).toMatch(/dynamic|callback|dispatch/i);
  });

  it('routes the next step back into codegraph, never to grep or Read', () => {
    const text = buildNoEdgeGuidance('orphan', nodes, 'callers');
    expect(text).toMatch(/codegraph_(explore|impact)/);
    expect(text).not.toMatch(/\bgrep\b|\bRead\b/);
  });

  it('speaks of callees when asked about callees', () => {
    const text = buildNoEdgeGuidance('orphan', nodes, 'callees');
    expect(text).toContain('callees');
    expect(text).not.toContain('No callers');
  });

  it('reports every definition when a name is defined more than once', () => {
    const text = buildNoEdgeGuidance(
      'dup',
      [fakeNode('dup', 'src/a.ts', 3), fakeNode('dup', 'src/b.ts', 9)],
      'callers'
    );
    expect(text).toContain('src/a.ts:3');
    expect(text).toContain('src/b.ts:9');
  });
});

describe('codegraph_callers on a real index', () => {
  let testDir: string;
  let cg: CodeGraph;
  let handler: ToolHandler;

  beforeAll(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-noedge-'));
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'a.ts'),
      'export function orphanHelper(): number { return 41; }\n' +
        'export function usedHelper(): number { return 1; }\n' +
        'export function main(): number { return usedHelper(); }\n'
    );
    cg = CodeGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterAll(() => {
    if (cg) cg.destroy();
    if (testDir && fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('an uncalled function answers with its location and a codegraph next step', async () => {
    const result = await handler.execute('codegraph_callers', { symbol: 'orphanHelper' });
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('orphanHelper');
    expect(text).toContain('a.ts:1');
    expect(text).toMatch(/codegraph_(explore|impact)/);
  });

  it('a called function still lists its callers', async () => {
    const result = await handler.execute('codegraph_callers', { symbol: 'usedHelper' });
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('main');
  });
});
