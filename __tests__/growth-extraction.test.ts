/**
 * Growth backlog — extraction cluster.
 *
 * #3: TS assertion wrappers (`as const`, `satisfies T`, `as T`, `x!`) around an
 * exported-const object-of-functions must be unwrapped so each member function
 * is extracted as a node. Without unwrap, `export const R = {a(){},b(){}} as const`
 * loses the whole object-of-functions DSL from search/trace.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';
import CodeGraph from '../src/index';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

const fixtureDirs: string[] = [];
const cgInstances: CodeGraph[] = [];

afterEach(() => {
  while (cgInstances.length) {
    try { cgInstances.pop()!.destroy(); } catch { /* already closed */ }
  }
  while (fixtureDirs.length) {
    const d = fixtureDirs.pop()!;
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('#3 unwrap TS assertion wrappers around object-of-functions', () => {
  it('extracts members from `as const` wrapped object', () => {
    const code = `
export const R = {
  alpha() { return 1; },
  beta() { return 2; },
} as const;
`;
    const result = extractFromSource('routes.ts', code);
    const fnNames = result.nodes.filter((n) => n.kind === 'function').map((n) => n.name);
    expect(fnNames).toContain('alpha');
    expect(fnNames).toContain('beta');
  });

  it('extracts members from `satisfies T` wrapped object', () => {
    const code = `
type Handlers = Record<string, () => number>;
export const H = {
  gamma() { return 3; },
  delta: () => 4,
} satisfies Handlers;
`;
    const result = extractFromSource('handlers.ts', code);
    const fnNames = result.nodes.filter((n) => n.kind === 'function').map((n) => n.name);
    expect(fnNames).toContain('gamma');
    expect(fnNames).toContain('delta');
  });

  it('extracts members from `as T` wrapped object', () => {
    const code = `
type Map = { epsilon(): number; zeta(): number };
export const M = {
  epsilon() { return 5; },
  zeta() { return 6; },
} as Map;
`;
    const result = extractFromSource('map.ts', code);
    const fnNames = result.nodes.filter((n) => n.kind === 'function').map((n) => n.name);
    expect(fnNames).toContain('epsilon');
    expect(fnNames).toContain('zeta');
  });

  it('walks member bodies for calls through the assertion wrapper', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-growth-ext-'));
    fixtureDirs.push(dir);
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'calls.ts'),
      `
export function helper() { return 0; }
export const R = {
  eta() { return helper(); },
} as const;
`
    );

    const cg = CodeGraph.initSync(dir, {
      config: { include: ['src/**/*.ts'], exclude: [] },
    });
    cgInstances.push(cg);
    await cg.indexAll();
    cg.resolveReferences();

    const eta = cg.getNodesByKind('function').find((n) => n.name === 'eta');
    expect(eta).toBeDefined();
    const callees = cg.getCallees(eta!.id);
    expect(callees.some((c) => c.node.name === 'helper')).toBe(true);
  });
});
