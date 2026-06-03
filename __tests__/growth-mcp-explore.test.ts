/**
 * Growth backlog cluster `mcp-explore` — codegraph_explore retrieval fixes.
 *
 * Items (see plan):
 *   #1  anchor truncation — the explicitly-queried god-file symbol must render
 *       its WHOLE body (cap raised for the anchor), not `(trimmed)`.
 *   #2/#11 generated deprioritization — `/generated/` paths sort AFTER
 *       hand-written src in the handleExplore comparator.
 *   #7  budget note — the "Explore budget" line reports the tier's real
 *       `defaultMaxFiles`, not a hardcoded `~6 files`.
 *   #12 co-name guard — an exact-unique single-symbol query ranks its own file
 *       above files matched only by a short ambiguous callee name.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ToolHandler,
  isGeneratedExplorePath,
  buildExploreBudgetNote,
  getExploreOutputBudget,
} from '../src/mcp/tools';
import CodeGraph from '../src/index';

/** Return the `#### <path> ...` section for a file basename. */
function sectionFor(text: string, basename: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('#### ') && l.includes(basename));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('### ') || lines[i].startsWith('#### ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

// ---------------------------------------------------------------------------
// #7 — budget note pure helper
// ---------------------------------------------------------------------------
describe('#7 buildExploreBudgetNote — reports the real defaultMaxFiles', () => {
  it('uses the tier defaultMaxFiles, never the hardcoded ~6 files', () => {
    // medium tier (500..4999) → defaultMaxFiles 10
    const note = buildExploreBudgetNote(2, 1951, getExploreOutputBudget(1951));
    expect(note).not.toContain('~6 files');
    expect(note).toContain('10 files');
    expect(note).toContain('2 calls');
    expect(note).toContain('1,951 files indexed');
  });

  it('tracks the large tier (12 files) too', () => {
    const note = buildExploreBudgetNote(3, 10446, getExploreOutputBudget(10446));
    expect(note).toContain('12 files');
    expect(note).not.toContain('~6');
  });
});

// ---------------------------------------------------------------------------
// #2 / #11 — generated path detector for the comparator
// ---------------------------------------------------------------------------
describe('#2/#11 isGeneratedExplorePath — deprioritizes generated/', () => {
  it('flags paths under a generated/ segment', () => {
    expect(isGeneratedExplorePath('src/generated/Shape.ts')).toBe(true);
    expect(isGeneratedExplorePath('packages/x/generated/icons/IconV1.ts')).toBe(true);
    expect(isGeneratedExplorePath('GENERATED/Foo.ts')).toBe(true);
  });
  it('does not flag hand-written src', () => {
    expect(isGeneratedExplorePath('src/core/helpers/components.ts')).toBe(false);
    expect(isGeneratedExplorePath('src/regenerate.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #2 / #11 — comparator ordering on a real indexed fixture
// ---------------------------------------------------------------------------
describe('#2/#11 explore output ranks hand-written src above generated/', () => {
  let testDir: string;
  let cg: CodeGraph;
  let handler: ToolHandler;

  beforeAll(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-growth-gen-'));
    const srcDir = path.join(testDir, 'src');
    const genDir = path.join(srcDir, 'generated');
    fs.mkdirSync(genDir, { recursive: true });

    // Three nearly-identical generated `Shape` type stubs.
    for (const v of ['V1', 'V2', 'V3']) {
      fs.writeFileSync(
        path.join(genDir, `shape-${v.toLowerCase()}.ts`),
        `export type Shape${v} = { kind: string; width: number; height: number };\n` +
          `export function shapeArea${v}(s: Shape${v}): number { return s.width * s.height; }\n`
      );
    }
    // The authoritative hand-written helper.
    fs.writeFileSync(
      path.join(srcDir, 'components.ts'),
      `export type Shape = { kind: string };\n` +
        `export function shapeArea(s: { width: number; height: number }): number {\n` +
        `  return s.width * s.height;\n}\n`
    );

    cg = CodeGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterAll(() => {
    if (cg) cg.destroy();
    if (testDir && fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('the hand-written components.ts is emitted before any generated/ file', async () => {
    const result = await handler.execute('codegraph_explore', { query: 'Shape shapeArea', maxFiles: 12 });
    const text = result.content?.[0]?.text ?? '';
    const compIdx = text.indexOf('components.ts');
    const genIdx = text.indexOf('generated/');
    expect(compIdx, 'components.ts must appear').toBeGreaterThanOrEqual(0);
    if (genIdx >= 0) {
      expect(compIdx, 'hand-written src must precede generated/').toBeLessThan(genIdx);
    }
  });
});

// ---------------------------------------------------------------------------
// #1 — anchor (queried symbol) renders its full body, not (trimmed)
// ---------------------------------------------------------------------------
describe('#1 anchor symbol is shown in full, siblings truncate instead', () => {
  let testDir: string;
  let cg: CodeGraph;
  let handler: ToolHandler;
  const MARKER = 'ANCHOR_TAIL_MARKER';

  beforeAll(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-growth-anchor-'));
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    // A single fat function `buildAlertView` whose body is comfortably over the
    // small/medium per-file cap (3800/6500) yet under the raised anchor ceiling
    // (~14000) — mirrors SDUI's 312-line buildAlertView. The tail marker lives
    // near the end, so a blind slice at maxCharsPerFile would lose it; as the
    // explicitly-queried anchor it must survive in full.
    const lines: string[] = ['export function buildAlertView(input: string): string {'];
    lines.push('  let acc = input;');
    // >220 lines so it goes through the clustering path (not the whole-small-file
    // shortcut), where the per-file cap actually trims — that's the regressed slice.
    for (let i = 0; i < 300; i++) {
      lines.push(`  acc = acc + "seg_${i}_pad_txt";`);
    }
    lines.push(`  const tail = "${MARKER}";`);
    lines.push('  return acc + tail;');
    lines.push('}');
    fs.writeFileSync(path.join(srcDir, 'components.ts'), lines.join('\n'));

    // A small supporting file so the project has >1 file.
    fs.writeFileSync(
      path.join(srcDir, 'caller.ts'),
      `import { buildAlertView } from './components';\nexport function show() { return buildAlertView('hi'); }\n`
    );

    cg = CodeGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterAll(() => {
    if (cg) cg.destroy();
    if (testDir && fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('renders the whole anchor body including its tail marker', async () => {
    const result = await handler.execute('codegraph_explore', { query: 'buildAlertView' });
    const text = result.content?.[0]?.text ?? '';
    const section = sectionFor(text, 'components.ts');
    expect(section, 'components.ts must be present').not.toBe('');
    expect(section, 'the queried anchor must not be tail-trimmed').toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// #12 — co-name pollution: exact-unique query ranks its own file first
// ---------------------------------------------------------------------------
describe('#12 single-symbol explore prioritizes the queried symbol over co-named siblings', () => {
  let testDir: string;
  let cg: CodeGraph;
  let handler: ToolHandler;

  beforeAll(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-growth-coname-'));
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    // The queried, exact-unique symbol lives in components.ts.
    fs.writeFileSync(
      path.join(srcDir, 'components.ts'),
      `export function buildAlertView(input: string): string {\n` +
        `  const tag = 'ALERT_VIEW_MARKER';\n` +
        `  return tag + input;\n}\n`
    );

    // Seven unrelated files each exporting a short ambiguous `build()` — a
    // co-naming collision that must not steal the full-source slots.
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(
        path.join(srcDir, `screen-${i}.ts`),
        `export function build(): string {\n  return 'SCREEN_${i}_BUILD_MARKER';\n}\n`
      );
    }

    cg = CodeGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterAll(() => {
    if (cg) cg.destroy();
    if (testDir && fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('components.ts (the queried symbol) is the FIRST source section with its body', async () => {
    const result = await handler.execute('codegraph_explore', { query: 'buildAlertView' });
    const text = result.content?.[0]?.text ?? '';
    const section = sectionFor(text, 'components.ts');
    expect(section, 'the queried symbol file must be present').not.toBe('');
    expect(section, 'the queried symbol body must be shown').toContain('ALERT_VIEW_MARKER');

    // The queried symbol's file must be the FIRST `#### ` source header — the
    // ambiguous `build()` siblings must not claim a slot ahead of it.
    const headers = text.split('\n').filter((l) => l.startsWith('#### '));
    expect(headers.length, 'at least one source section').toBeGreaterThan(0);
    expect(headers[0], 'the queried symbol file must be rendered first').toContain('components.ts');
  });

  it('the ambiguous co-named build() siblings do not crowd out the queried symbol', async () => {
    const result = await handler.execute('codegraph_explore', { query: 'buildAlertView' });
    const text = result.content?.[0]?.text ?? '';

    // `build` resolves to >5 nodes (7 screens) → ambiguous co-name pollution.
    // None of the screen siblings should precede the queried symbol's file, and
    // they must be sunk below it (the comparator demotes pollution).
    const compIdx = text.indexOf('components.ts');
    const firstScreenIdx = text.indexOf('screen-');
    expect(compIdx, 'components.ts must appear').toBeGreaterThanOrEqual(0);
    if (firstScreenIdx >= 0) {
      expect(compIdx, 'a co-named sibling must not precede the queried symbol').toBeLessThan(firstScreenIdx);
    }
  });
});
