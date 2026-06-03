/**
 * Growth backlog — search-rank cluster (#4, #5, #6, #10).
 *
 * Generated-file demotion + deterministic FTS tie-break + single-char
 * exact-name supplement. Pure scoring/helper functions are unit-tested
 * directly; FTS ordering / single-char lookup use a real indexed fixture.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';
import {
  isGeneratedFile,
  scorePathRelevance,
} from '../src/search/query-utils';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-search-rank-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('#10/#6 isGeneratedFile helper', () => {
  it('detects a /generated/ path segment', () => {
    expect(isGeneratedFile('src/generated/types/Alignment.ts')).toBe(true);
    expect(isGeneratedFile('generated/index.ts')).toBe(true);
    expect(isGeneratedFile('src/screens/login.ts')).toBe(false);
  });

  it('detects an @generated docstring marker', () => {
    const doc = '@generated from SDUI JSON Schema — do not edit';
    expect(isGeneratedFile('src/converter/Alignment.ts', doc)).toBe(true);
    expect(isGeneratedFile('src/converter/Alignment.ts', 'normal docs')).toBe(false);
  });
});

describe('#10 generated-file demotion in scorePathRelevance', () => {
  it('demotes a generated-path file below an equally-named handwritten one', () => {
    const handwritten = scorePathRelevance('src/converter/Alignment.ts', 'Alignment');
    const generated = scorePathRelevance('src/generated/types/Alignment.ts', 'Alignment');
    expect(generated).toBeLessThan(handwritten);
  });

  it('demotes via @generated docstring even when the path is clean', () => {
    const doc = '@generated from SDUI JSON Schema';
    const clean = scorePathRelevance('src/types/Alignment.ts', 'Alignment');
    const demoted = scorePathRelevance('src/types/Alignment.ts', 'Alignment', doc);
    expect(demoted).toBeLessThan(clean);
  });

  it('does not demote when the query explicitly targets generated/', () => {
    const plain = scorePathRelevance('src/generated/types/Alignment.ts', 'Alignment');
    const targeted = scorePathRelevance('src/generated/types/Alignment.ts', 'generated Alignment');
    expect(targeted).toBeGreaterThan(plain);
  });
});

describe('#6 generated barrel index demotion in scorePathRelevance', () => {
  it('demotes a generated barrel index file below a real symbol-bearing file', () => {
    // The bug: every generated/*/index.ts barrel scores high for short
    // queries and floods the window. A barrel under generated/ must rank
    // below a same-query handwritten file.
    const barrel = scorePathRelevance('src/generated/widgets/index.ts', 'index', undefined, 'file');
    const real = scorePathRelevance('src/core/indexer.ts', 'index', undefined, 'function');
    expect(barrel).toBeLessThan(real);
  });

  it('does not demote a handwritten barrel index outside generated/', () => {
    const generatedBarrel = scorePathRelevance('src/generated/a/index.ts', 'index', undefined, 'file');
    const normalBarrel = scorePathRelevance('src/feature/index.ts', 'index', undefined, 'file');
    expect(generatedBarrel).toBeLessThan(normalBarrel);
  });
});

describe('#5 deterministic FTS tie-break (real fixture)', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = createTempDir(); });
  afterEach(() => { cleanupTempDir(tempDir); });

  it('ranks a handwritten same-name type above a generated stub on equal score', async () => {
    const gen = path.join(tempDir, 'generated', 'types');
    const src = path.join(tempDir, 'src', 'schema');
    fs.mkdirSync(gen, { recursive: true });
    fs.mkdirSync(src, { recursive: true });

    // Two same-named exported type aliases: one generated, one handwritten.
    fs.writeFileSync(
      path.join(gen, 'Alignment.ts'),
      `export type Alignment = 'left' | 'right';\n`
    );
    fs.writeFileSync(
      path.join(src, 'Alignment.ts'),
      `export type Alignment = 'start' | 'end' | 'center';\n`
    );

    const cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();

    const results = cg.searchNodes('Alignment', { limit: 10 });
    const aligns = results.filter((r) => r.node.name === 'Alignment');
    expect(aligns.length).toBeGreaterThanOrEqual(2);

    // The handwritten (non-generated) Alignment must appear before the
    // generated one — deterministic tie-break, not rowid order.
    const handwrittenIdx = aligns.findIndex((r) => !r.node.filePath.includes('generated'));
    const generatedIdx = aligns.findIndex((r) => r.node.filePath.includes('generated'));
    expect(handwrittenIdx).toBeGreaterThanOrEqual(0);
    expect(generatedIdx).toBeGreaterThanOrEqual(0);
    expect(handwrittenIdx).toBeLessThan(generatedIdx);

    cg.close();
  });
});

describe('#4 single-char exact-name supplement (real fixture)', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = createTempDir(); });
  afterEach(() => { cleanupTempDir(tempDir); });

  it('finds a 1-character non-word-token symbol ($) by exact name', async () => {
    // FTS tokenizer drops `$` and other punctuation, and the LIKE/fuzzy/
    // exact-supplement paths all gate on length >= 2/3, so a 1-char name
    // like `$` is unreachable through search despite existing in the graph.
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(
      path.join(src, 'expr.ts'),
      `export const $ = (x: number): number => x * 2;\n` +
      `export function isExpr(v: unknown): boolean { return typeof v === 'object'; }\n`
    );

    const cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();

    const results = cg.searchNodes('$', { limit: 10 });
    const hit = results.find((r) => r.node.name === '$');
    expect(hit).toBeDefined();

    cg.close();
  });
});
