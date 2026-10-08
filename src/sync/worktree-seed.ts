/**
 * Worktree Index Seeding
 *
 * A linked git worktree without its own `.codegraph/` would otherwise answer
 * "not initialized" (sibling layout) or borrow another tree's index (nested
 * layout, issue #155). Worktrees of one repo differ by a branch's worth of
 * files, so copying an indexed sibling's database and letting sync() reconcile
 * the difference yields the worktree's own index for a fraction of a full
 * index run. Stored paths are project-relative, so the copy is portable.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type CodeGraph from '../index';
import { createDirectory, getCodeGraphDir, isInitialized } from '../directory';

/**
 * Copy `source`'s index into `worktreeRoot/.codegraph/codegraph.db`. The copy
 * is written under a temp name and hard-linked into place, so a concurrent
 * reader never opens a half-written database. Returns false when an index
 * already exists or another process published first. Caller runs sync().
 */
export function seedWorktreeIndex(source: CodeGraph, worktreeRoot: string): boolean {
  if (isInitialized(worktreeRoot)) return false;
  try {
    createDirectory(worktreeRoot);
  } catch (err) {
    if (isInitialized(worktreeRoot)) return false;
    throw err;
  }

  const dir = getCodeGraphDir(worktreeRoot);
  // *.db so a crash mid-copy leaves nothing git would show as untracked.
  const tmp = path.join(dir, `seed-${randomUUID()}.db`);
  try {
    source.snapshotTo(tmp);
    fs.linkSync(tmp, path.join(dir, 'codegraph.db'));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
