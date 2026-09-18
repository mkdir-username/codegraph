/**
 * Growth backlog — the CLI's `callers`/`callees` dead-ended the same way the MCP
 * tools did (`src/bin/codegraph.ts`, bare `No callers found for "X"`). Both
 * surfaces now speak through one helper, which lives outside `src/mcp/` on
 * purpose: the CLI keeps its heavy core behind `loadCodeGraph()`, so it must be
 * able to import the wording without pulling SQLite and tree-sitter at startup.
 */
import { describe, it, expect } from 'vitest';
import { buildNoEdgeGuidance } from '../src/graph/no-edge-guidance';
import type { Node } from '../src/types';

const orphan = {
  id: 'src/a.ts:orphan',
  name: 'orphan',
  kind: 'function',
  filePath: 'src/a.ts',
  startLine: 4,
} as Node;

describe('buildNoEdgeGuidance — CLI surface', () => {
  it('предлагает команды CLI, а не имена MCP-инструментов', () => {
    const text = buildNoEdgeGuidance('orphan', [orphan], 'callers', 'cli');
    expect(text).toContain('codegraph context');
    expect(text).not.toContain('codegraph_explore');
    expect(text).toContain('src/a.ts:4');
  });

  it('для callees тоже остаётся в CLI-словаре', () => {
    const text = buildNoEdgeGuidance('orphan', [orphan], 'callees', 'cli');
    expect(text).toContain('callees');
    expect(text).not.toContain('codegraph_trace');
  });

  it('по умолчанию остаётся MCP-поверхностью', () => {
    expect(buildNoEdgeGuidance('orphan', [orphan], 'callers')).toContain('codegraph_explore');
  });
});
