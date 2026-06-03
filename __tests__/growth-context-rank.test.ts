/**
 * Growth cluster: context-rank (#14)
 *
 * Flow/action-shaped task phrasing must surface the matching function/method
 * as the leading entry point, not an equal-match type_alias/interface/enum —
 * and trivial aliases (= any/= unknown, single-token re-export) must be
 * demoted out of Entry Points.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import CodeGraph from '../src/index';

describe('context-rank (#14)', () => {
  let testDir: string;
  let cg: CodeGraph;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-ctxrank-test-'));
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    // A flow where a trivial `= any` alias and an interface share the "validate"/
    // "property" tokens with the real validator function. Statically the alias
    // sorts to a root; we want the function to lead an action-shaped query.
    fs.writeFileSync(
      path.join(srcDir, 'property.ts'),
      `export type PropertyValue = any;

export interface PropertyValidationResult {
  valid: boolean;
  reason: string;
}

export function validatePropertyValue(value: PropertyValue): PropertyValidationResult {
  if (value === undefined || value === null) {
    return { valid: false, reason: 'missing' };
  }
  return { valid: true, reason: 'ok' };
}

export function getPropertyState(value: PropertyValue): string {
  const result = validatePropertyValue(value);
  return result.valid ? 'valid' : 'invalid';
}
`
    );

    cg = CodeGraph.initSync(testDir, {
      config: { include: ['**/*.ts'], exclude: [] },
    });
    await cg.indexAll();
  });

  afterEach(() => {
    if (cg) cg.destroy();
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('leads with the matching function for an action/flow-shaped query, not a type_alias', async () => {
    const result = await cg.buildContext('how does a property value get validated', {
      format: 'json',
    });
    const parsed = JSON.parse(result as string) as {
      entryPoints: Array<{ name: string; kind: string }>;
    };

    expect(parsed.entryPoints.length).toBeGreaterThan(0);

    const leading = parsed.entryPoints[0];
    expect(['function', 'method']).toContain(leading.kind);
    expect(leading.name).toBe('validatePropertyValue');
  });

  it('demotes a trivial `= any` alias out of entry points for an action query', async () => {
    const result = await cg.buildContext('how does a property value get validated', {
      format: 'json',
    });
    const parsed = JSON.parse(result as string) as {
      entryPoints: Array<{ name: string; kind: string }>;
    };

    const aliasEntry = parsed.entryPoints.find((n) => n.name === 'PropertyValue');
    expect(aliasEntry).toBeUndefined();
  });
});
