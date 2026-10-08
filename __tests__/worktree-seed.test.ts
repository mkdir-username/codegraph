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
