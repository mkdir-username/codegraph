/**
 * Seeding a git worktree's index from an already-indexed sibling worktree.
 * Real git, real temp worktrees, real SQLite — no mocking.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import CodeGraph from '../src/index';
import { findIndexedSiblingWorktree } from '../src/sync/worktree';
import { seedWorktreeIndex } from '../src/sync/worktree-seed';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { ToolHandler } from '../src/mcp/tools';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

/** realpath so macOS /var → /private/var symlinking doesn't break equality. */
function real(p: string): string {
  return fs.realpathSync(path.resolve(p));
}

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-seed-main-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export function shared() { return 1; }\n');
  fs.writeFileSync(
    path.join(repo, 'src', 'b.ts'),
    "import { shared } from './a';\nexport function caller() { return shared(); }\n",
  );
  fs.writeFileSync(path.join(repo, 'src', 'gone.ts'), 'export function mainOnly() { return 2; }\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

/** Worktree on its own branch: a.ts changed, c.ts added, gone.ts removed. */
function addDivergedWorktree(repo: string, parent: string, name = 'wt'): string {
  const wt = path.join(parent, name);
  git(repo, 'worktree', 'add', '-q', '-b', `feature-${name}`, wt);
  fs.writeFileSync(
    path.join(wt, 'src', 'a.ts'),
    'export function shared() { return 1; }\nexport function worktreeOnly() { return 3; }\n',
  );
  fs.writeFileSync(
    path.join(wt, 'src', 'c.ts'),
    "import { worktreeOnly } from './a';\nexport function newCaller() { return worktreeOnly(); }\n",
  );
  fs.rmSync(path.join(wt, 'src', 'gone.ts'));
  return wt;
}

describe('findIndexedSiblingWorktree', () => {
  let repo: string;
  let parent: string;
  let wt: string;

  beforeEach(() => {
    repo = makeRepo();
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-seed-wts-'));
    wt = addDivergedWorktree(repo, parent);
  });

  afterEach(() => {
    try { git(repo, 'worktree', 'remove', '--force', wt); } catch { /* best effort */ }
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('returns the indexed main checkout for a sibling worktree', async () => {
    const cg = CodeGraph.initSync(repo);
    await cg.indexAll();
    cg.close();
    expect(findIndexedSiblingWorktree(wt)).toBe(real(repo));
  });

  it('returns null when no worktree of the repo is indexed', () => {
    expect(findIndexedSiblingWorktree(wt)).toBeNull();
  });

  it('never returns the worktree itself', async () => {
    const cg = CodeGraph.initSync(wt);
    await cg.indexAll();
    cg.close();
    expect(findIndexedSiblingWorktree(wt)).toBeNull();
  });

  it('returns null outside git', () => {
    expect(findIndexedSiblingWorktree(parent)).toBeNull();
  });
});

/** Order-independent fingerprint of a graph: nodes and edges by name, not id. */
function graphShape(root: string): { nodes: string[]; edges: string[] } {
  const conn = DatabaseConnection.open(getDatabasePath(root));
  try {
    const db = conn.getDb();
    const nodes = (db.prepare(
      "SELECT kind || ':' || name || ':' || file_path AS k FROM nodes ORDER BY k",
    ).all() as Array<{ k: string }>).map((r) => r.k);
    const edges = (db.prepare(
      "SELECT e.kind || ':' || s.name || '>' || t.name AS k FROM edges e " +
      'JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target ORDER BY k',
    ).all() as Array<{ k: string }>).map((r) => r.k);
    return { nodes, edges };
  } finally {
    conn.close();
  }
}

describe('seedWorktreeIndex', () => {
  let repo: string;
  let parent: string;
  let wt: string;
  let twin: string;
  let main: CodeGraph;

  beforeEach(async () => {
    repo = makeRepo();
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-seed-wts-'));
    wt = addDivergedWorktree(repo, parent);
    twin = '';
    main = CodeGraph.initSync(repo);
    await main.indexAll();
  });

  afterEach(() => {
    try { main.close(); } catch { /* best effort */ }
    for (const w of [wt, twin].filter(Boolean)) {
      try { git(repo, 'worktree', 'remove', '--force', w); } catch { /* best effort */ }
    }
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('publishes a full codegraph.db and leaves no temp files', () => {
    expect(seedWorktreeIndex(main, wt)).toBe(true);
    const files = fs.readdirSync(path.join(wt, '.codegraph')).sort();
    expect(files).toEqual(['.gitignore', 'codegraph.db']);
    expect(CodeGraph.isInitialized(wt)).toBe(true);
  });

  it('is a no-op when the worktree already has an index', () => {
    expect(seedWorktreeIndex(main, wt)).toBe(true);
    expect(seedWorktreeIndex(main, wt)).toBe(false);
  });

  it('after sync equals a fresh index of the same tree', async () => {
    seedWorktreeIndex(main, wt);
    const seeded = CodeGraph.openSync(wt);
    await seeded.sync();
    seeded.close();

    // Same content, indexed from scratch, in a second worktree.
    twin = path.join(parent, 'twin');
    git(repo, 'worktree', 'add', '-q', '--detach', twin, 'HEAD');
    for (const f of ['a.ts', 'c.ts']) {
      fs.copyFileSync(path.join(wt, 'src', f), path.join(twin, 'src', f));
    }
    fs.rmSync(path.join(twin, 'src', 'gone.ts'));
    const fresh = CodeGraph.initSync(twin);
    await fresh.indexAll();
    fresh.close();

    const a = graphShape(wt);
    const b = graphShape(twin);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
    expect(a.edges.some((e) => e.endsWith('caller>shared'))).toBe(true);
    expect(a.nodes.some((n) => n.includes(':worktreeOnly:'))).toBe(true);
    expect(a.nodes.some((n) => n.includes(':mainOnly:'))).toBe(false);
  });

  it('leaves the source index untouched', () => {
    const before = graphShape(repo);
    seedWorktreeIndex(main, wt);
    expect(graphShape(repo)).toEqual(before);
  });
});

describe('ToolHandler seeds a worktree on first call', () => {
  let repo: string;
  let parent: string;
  let wt: string;
  let nested: string;
  let main: CodeGraph;
  let handler: ToolHandler;

  beforeEach(async () => {
    repo = makeRepo();
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-seed-wts-'));
    wt = addDivergedWorktree(repo, parent);
    nested = '';
    main = CodeGraph.initSync(repo);
    await main.indexAll();
    handler = new ToolHandler(main);
  });

  afterEach(() => {
    handler.closeAll();
    try { main.close(); } catch { /* best effort */ }
    for (const w of [wt, nested].filter(Boolean)) {
      try { git(repo, 'worktree', 'remove', '--force', w); } catch { /* best effort */ }
    }
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('sibling worktree: answers from its own synced index', async () => {
    const res = await handler.execute('codegraph_search', { query: 'worktreeOnly', projectPath: wt });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('worktreeOnly');
    expect(CodeGraph.isInitialized(wt)).toBe(true);
  });

  it('sibling worktree: callers of a symbol in a changed file survive', async () => {
    const res = await handler.execute('codegraph_callers', { symbol: 'shared', projectPath: wt });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('caller');
  });

  it('sibling worktree: symbols deleted in the worktree are gone', async () => {
    const res = await handler.execute('codegraph_search', { query: 'mainOnly', projectPath: wt });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).not.toContain('gone.ts');
  });

  it('subdirectory projectPath seeds the worktree root', async () => {
    const res = await handler.execute('codegraph_search', {
      query: 'worktreeOnly', projectPath: path.join(wt, 'src'),
    });
    expect(res.isError).toBeFalsy();
    expect(CodeGraph.isInitialized(wt)).toBe(true);
    expect(fs.existsSync(path.join(wt, 'src', '.codegraph'))).toBe(false);
  });

  it('nested worktree: own index instead of the borrowed one, no #155 notice', async () => {
    nested = addDivergedWorktree(repo, repo, 'nested');
    const res = await handler.execute('codegraph_search', { query: 'worktreeOnly', projectPath: nested });
    expect(res.content[0].text).toContain('worktreeOnly');
    expect(res.content[0].text).not.toContain('different git worktree');
    expect(CodeGraph.isInitialized(nested)).toBe(true);
  });

  it('no indexed sibling: keeps the "not initialized" error and writes nothing', async () => {
    const lone = makeRepo();
    try {
      const res = await handler.execute('codegraph_search', { query: 'shared', projectPath: lone });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('CodeGraph not initialized');
      expect(fs.existsSync(path.join(lone, '.codegraph'))).toBe(false);
    } finally {
      fs.rmSync(lone, { recursive: true, force: true });
    }
  });
});
