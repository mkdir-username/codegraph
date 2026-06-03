import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CodeGraph } from '../src';

/**
 * Dispatch-table synthesizer (#9): a const object/Record literal that maps keys
 * to bare function identifiers, invoked via a computed-member call
 * (`MAP[k](...)`), should synthesize `calls` edges from the invoking function to
 * every handler in the map.
 */
describe('dispatch-table synthesizer', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-table-fixture-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function querySynth(cg: CodeGraph) {
    const db = (cg as any).db.db;
    return db
      .prepare(
        `SELECT s.name source_name, t.name target_name
           FROM edges e
           JOIN nodes s ON s.id = e.source
           JOIN nodes t ON t.id = e.target
          WHERE json_extract(e.metadata,'$.synthesizedBy') = 'dispatch-table'
            AND e.provenance = 'heuristic'`
      )
      .all() as Array<{ source_name: string; target_name: string }>;
  }

  it('synthesizes calls edges from MAP[k]() invoker to every handler', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
    fs.writeFileSync(
      path.join(dir, 'element-to-helper.ts'),
      `
type ElementType = 'Spacer' | 'Stack' | 'Text';
type HandlerFn = (el: unknown, depth: number) => string;

function spacerToHelper(el: unknown, depth: number): string {
  return 'spacer';
}
function stackToHelper(el: unknown, depth: number): string {
  return 'stack';
}
function textToHelper(el: unknown, depth: number): string {
  return 'text';
}

const HANDLERS: Record<ElementType, HandlerFn> = {
  Spacer: spacerToHelper,
  Stack: stackToHelper,
  Text: textToHelper,
};

export function contractToTs(el: { type: ElementType }, depth: number): string {
  return HANDLERS[el.type](el, depth);
}
`
    );

    const cg = await CodeGraph.init(dir, { silent: true });
    await cg.indexAll();
    const rows = querySynth(cg);
    cg.close?.();

    const targets = rows
      .filter((r) => r.source_name === 'contractToTs')
      .map((r) => r.target_name)
      .sort();
    expect(targets).toEqual(['spacerToHelper', 'stackToHelper', 'textToHelper']);
  });

  it('does NOT synthesize when the map values are not bare function identifiers (anti-explosion)', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"y"}');
    fs.writeFileSync(
      path.join(dir, 'config.ts'),
      `
const CONFIG: Record<string, number> = {
  a: 1,
  b: 2,
  c: 3,
};

export function pick(k: string): number {
  return CONFIG[k];
}
`
    );

    const cg = await CodeGraph.init(dir, { silent: true });
    await cg.indexAll();
    const rows = querySynth(cg);
    cg.close?.();

    expect(rows.length).toBe(0);
  });

  it('synthesizes for a typed map MIXING bare handlers with inline arrows (real strategy-table shape)', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"z"}');
    fs.writeFileSync(
      path.join(dir, 'handlers.ts'),
      `
function spacerToHelper(el: any, depth: number) { return el; }
function stackToHelper(el: any, depth: number) { return el; }
function genericToHelper(el: any, kind: string, depth: number) { return el; }

const HANDLERS: Record<string, (el: any, depth: number) => any> = {
  Spacer: spacerToHelper,
  StackView: stackToHelper,
  CardIconView: (el, depth) => genericToHelper(el, 'CardIcon', depth),
  DataContent: (el, depth) => genericToHelper(el, 'DataContent', depth),
};

export function contractToTs(el: any, depth: number) {
  return HANDLERS[el.type](el, depth);
}
`
    );

    const cg = await CodeGraph.init(dir, { silent: true });
    await cg.indexAll();
    const rows = querySynth(cg);
    cg.close?.();

    const targets = rows
      .filter((r) => r.source_name === 'contractToTs')
      .map((r) => r.target_name)
      .sort();
    // bare-identifier handlers bridged; inline-arrow entries skipped (not fatal)
    expect(targets).toEqual(['spacerToHelper', 'stackToHelper']);
  });
});
