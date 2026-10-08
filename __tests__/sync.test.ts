/**
 * Sync Module Tests
 *
 * Tests for sync functionality (incremental updates).
 * Note: Git hooks functionality has been removed in favor of codegraph's
 * Claude Code hooks integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import CodeGraph from '../src/index';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { ExtractionOrchestrator } from '../src/extraction';

describe('Sync Module', () => {
  describe('Sync Functionality', () => {
    let testDir: string;
    let cg: CodeGraph;

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-sync-func-'));

      // Create initial source files
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(
        path.join(srcDir, 'index.ts'),
        `export function hello() { return 'world'; }`
      );

      // Initialize and index
      cg = CodeGraph.initSync(testDir, {
        config: {
          include: ['**/*.ts'],
          exclude: [],
        },
      });
      await cg.indexAll();
    });

    afterEach(() => {
      if (cg) {
        cg.destroy();
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    describe('getChangedFiles()', () => {
      it('should detect added files', () => {
        // Add a new file
        fs.writeFileSync(
          path.join(testDir, 'src', 'new.ts'),
          `export function newFunc() { return 42; }`
        );

        const changes = cg.getChangedFiles();

        expect(changes.added).toContain('src/new.ts');
        expect(changes.modified).toHaveLength(0);
        expect(changes.removed).toHaveLength(0);
      });

      it('should detect modified files', () => {
        // Modify existing file
        fs.writeFileSync(
          path.join(testDir, 'src', 'index.ts'),
          `export function hello() { return 'modified'; }`
        );

        const changes = cg.getChangedFiles();

        expect(changes.added).toHaveLength(0);
        expect(changes.modified).toContain('src/index.ts');
        expect(changes.removed).toHaveLength(0);
      });

      it('should detect removed files', () => {
        // Remove file
        fs.unlinkSync(path.join(testDir, 'src', 'index.ts'));

        const changes = cg.getChangedFiles();

        expect(changes.added).toHaveLength(0);
        expect(changes.modified).toHaveLength(0);
        expect(changes.removed).toContain('src/index.ts');
      });
    });

    describe('sync()', () => {
      it('should reindex added files', async () => {
        // Add a new file
        fs.writeFileSync(
          path.join(testDir, 'src', 'new.ts'),
          `export function newFunc() { return 42; }`
        );

        const result = await cg.sync();

        expect(result.filesAdded).toBe(1);
        expect(result.filesModified).toBe(0);
        expect(result.filesRemoved).toBe(0);

        // Verify new function is in the graph
        const nodes = cg.searchNodes('newFunc');
        expect(nodes.length).toBeGreaterThan(0);
      });

      it('should reindex modified files', async () => {
        // Modify existing file
        fs.writeFileSync(
          path.join(testDir, 'src', 'index.ts'),
          `export function goodbye() { return 'farewell'; }`
        );

        const result = await cg.sync();

        expect(result.filesModified).toBe(1);

        // Verify new function is in the graph
        const nodes = cg.searchNodes('goodbye');
        expect(nodes.length).toBeGreaterThan(0);

        // Verify old function is gone
        const oldNodes = cg.searchNodes('hello');
        expect(oldNodes.length).toBe(0);
      });

      it('should remove nodes from deleted files', async () => {
        // Remove file
        fs.unlinkSync(path.join(testDir, 'src', 'index.ts'));

        const result = await cg.sync();

        expect(result.filesRemoved).toBe(1);

        // Verify function is gone
        const nodes = cg.searchNodes('hello');
        expect(nodes.length).toBe(0);
      });

      it('should report no changes when nothing changed', async () => {
        const result = await cg.sync();

        expect(result.filesAdded).toBe(0);
        expect(result.filesModified).toBe(0);
        expect(result.filesRemoved).toBe(0);
        expect(result.filesChecked).toBeGreaterThan(0);
      });
    });
  });

  describe('Git-based sync', () => {
    let testDir: string;
    let cg: CodeGraph;

    function git(...args: string[]) {
      execFileSync('git', args, { cwd: testDir, stdio: 'pipe' });
    }

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-git-sync-'));

      // Initialize a git repo with an initial commit
      git('init');
      git('config', 'user.email', 'test@test.com');
      git('config', 'user.name', 'Test');

      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(
        path.join(srcDir, 'index.ts'),
        `export function hello() { return 'world'; }`
      );

      git('add', '-A');
      git('commit', '-m', 'initial');

      // Initialize CodeGraph and index
      cg = CodeGraph.initSync(testDir, {
        config: {
          include: ['**/*.ts'],
          exclude: [],
        },
      });
      await cg.indexAll();
    });

    afterEach(() => {
      if (cg) {
        cg.destroy();
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should detect modified files via git', async () => {
      fs.writeFileSync(
        path.join(testDir, 'src', 'index.ts'),
        `export function hello() { return 'modified'; }`
      );

      const result = await cg.sync();

      expect(result.filesModified).toBe(1);
      expect(result.changedFilePaths).toContain('src/index.ts');
    });

    it('should detect new untracked files via git', async () => {
      fs.writeFileSync(
        path.join(testDir, 'src', 'new.ts'),
        `export function newFunc() { return 42; }`
      );

      const result = await cg.sync();

      expect(result.filesAdded).toBe(1);
      expect(result.changedFilePaths).toContain('src/new.ts');

      // Verify the function was indexed
      const nodes = cg.searchNodes('newFunc');
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('should stop reporting untracked files once they are indexed (issue #206)', async () => {
      // Untracked files stay `??` in git status even after codegraph indexes
      // them. Change detection must compare them against the DB by hash, not
      // report every untracked file as "added" on every sync/status.
      fs.writeFileSync(
        path.join(testDir, 'src', 'new.ts'),
        `export function newFunc() { return 42; }`
      );

      // First sync indexes the untracked file.
      const first = await cg.sync();
      expect(first.filesAdded).toBe(1);

      // The file is still untracked in git, but now lives in the DB.
      expect(cg.searchNodes('newFunc').length).toBeGreaterThan(0);

      // status must not keep flagging it as a pending addition...
      const changes = cg.getChangedFiles();
      expect(changes.added).not.toContain('src/new.ts');
      expect(changes.modified).not.toContain('src/new.ts');

      // ...and a second sync must be a no-op for it.
      const second = await cg.sync();
      expect(second.filesAdded).toBe(0);
      expect(second.filesModified).toBe(0);
    });

    it('should re-index an untracked file when its contents change', async () => {
      const filePath = path.join(testDir, 'src', 'new.ts');
      fs.writeFileSync(filePath, `export function newFunc() { return 42; }`);
      await cg.sync();

      // Modify the still-untracked file.
      fs.writeFileSync(filePath, `export function renamedFunc() { return 7; }`);

      const changes = cg.getChangedFiles();
      expect(changes.modified).toContain('src/new.ts');

      const result = await cg.sync();
      expect(result.filesModified).toBe(1);
      expect(cg.searchNodes('renamedFunc').length).toBeGreaterThan(0);
      expect(cg.searchNodes('newFunc').length).toBe(0);
    });

    it('should detect deleted files via git', async () => {
      fs.unlinkSync(path.join(testDir, 'src', 'index.ts'));

      const result = await cg.sync();

      expect(result.filesRemoved).toBe(1);

      // Verify function is gone
      const nodes = cg.searchNodes('hello');
      expect(nodes.length).toBe(0);
    });

    it('should skip files with unsupported extensions', async () => {
      // A .txt file has no supported grammar, so sync must not index it.
      fs.writeFileSync(
        path.join(testDir, 'src', 'notes.txt'),
        `just some notes`
      );

      const result = await cg.sync();

      expect(result.filesAdded).toBe(0);
      expect(result.filesModified).toBe(0);
    });

    it('should report no changes on clean working tree', async () => {
      const result = await cg.sync();

      expect(result.filesAdded).toBe(0);
      expect(result.filesModified).toBe(0);
      expect(result.filesRemoved).toBe(0);
      expect(result.changedFilePaths).toBeUndefined();
    });
  });
});

describe('sync keeps edges from untouched files into rewritten ones', () => {
  let dir: string;
  let cg: CodeGraph;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-sync-incoming-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export function shared() { return 1; }\n');
    fs.writeFileSync(
      path.join(dir, 'src', 'b.ts'),
      "import { shared } from './a';\nexport function caller() { return shared(); }\n",
    );
    cg = CodeGraph.initSync(dir);
    await cg.indexAll();
  });

  afterEach(() => {
    try { cg.destroy(); } catch { /* best effort */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function callersOf(name: string): string[] {
    const n = cg.searchNodes(name).find((r) => r.node.name === name)!.node;
    return cg.getCallers(n.id).map((c) => c.node.name).sort();
  }

  it('caller survives when the callee file is edited and its lines shift', async () => {
    // getCallers also counts `imports` edges, so compare whole lists, not a literal.
    const before = callersOf('shared');
    expect(before).toContain('caller');
    fs.writeFileSync(
      path.join(dir, 'src', 'a.ts'),
      '// moved down\n\nexport function shared() { return 2; }\n',
    );
    await cg.sync();
    expect(callersOf('shared')).toEqual(before);
  });

  it('restore survives a file that fails to index', async () => {
    const before = callersOf('shared');
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), '// moved down\n\nexport function shared() { return 2; }\n');
    fs.writeFileSync(path.join(dir, 'src', 'z.ts'), 'export const z = 1;\n');
    const original = ExtractionOrchestrator.prototype.indexFile;
    let aIndexed = false;
    let threw = false;
    // Fail only AFTER a.ts was rewritten, whatever order the scan yields.
    const spy = vi.spyOn(ExtractionOrchestrator.prototype, 'indexFile').mockImplementation(
      async function (this: ExtractionOrchestrator, p: string) {
        if (p === 'src/a.ts') {
          const r = await original.call(this, p);
          aIndexed = true;
          return r;
        }
        if (aIndexed) {
          threw = true;
          throw new Error('parse exploded');
        }
        return original.call(this, p);
      },
    );
    try {
      await expect(cg.sync()).rejects.toThrow('parse exploded');
    } finally {
      spy.mockRestore();
    }
    expect(threw).toBe(true);
    expect(callersOf('shared')).toEqual(before);
  });

  it('edge is dropped when the callee is removed', async () => {
    const callsIntoA = (): number => {
      const conn = DatabaseConnection.open(getDatabasePath(dir));
      try {
        return (conn.getDb().prepare(
          'SELECT count(*) AS n FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target ' +
          "WHERE s.name = 'caller' AND t.file_path = 'src/a.ts' AND e.kind = 'calls'",
        ).get() as { n: number }).n;
      } finally {
        conn.close();
      }
    };
    expect(callsIntoA()).toBe(1);
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export function other() { return 3; }\n');
    await cg.sync();
    expect(cg.searchNodes('shared').filter((r) => r.node.name === 'shared')).toEqual([]);
    expect(callsIntoA()).toBe(0);
  });

  /** Plant a synthesized caller→shared edge whose wiring site is `registeredAt`. */
  function plantHeuristicEdge(registeredAt: string): void {
    const caller = cg.searchNodes('caller').find((r) => r.node.name === 'caller')!.node;
    const shared = cg.searchNodes('shared').find((r) => r.node.name === 'shared')!.node;
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    try {
      conn.getDb().prepare(
        "INSERT INTO edges (source, target, kind, metadata, provenance) VALUES (?, ?, 'calls', ?, 'heuristic')",
      ).run(caller.id, shared.id, JSON.stringify({ synthesizedBy: 'event-emitter', registeredAt }));
    } finally {
      conn.close();
    }
  }

  function heuristicEdgeCount(): number {
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    try {
      return (conn.getDb().prepare(
        "SELECT count(*) AS n FROM edges WHERE json_extract(metadata, '$.synthesizedBy') = 'event-emitter'",
      ).get() as { n: number }).n;
    } finally {
      conn.close();
    }
  }

  it('a synthesized edge the synthesizers no longer produce is gone after sync', async () => {
    plantHeuristicEdge('src/a.ts:1');
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), '// moved down\n\nexport function shared() { return 2; }\n');
    await cg.sync();
    expect(heuristicEdgeCount()).toBe(0);
  });

  it('same-file call is not duplicated when the file is rewritten', async () => {
    fs.writeFileSync(path.join(dir, 'src', 'g.ts'), 'function g() { return 1; }\nfunction f() { return g(); }\n');
    await cg.sync();
    const before = callersOf('g');
    expect(before).toContain('f');
    fs.appendFileSync(path.join(dir, 'src', 'g.ts'), 'export const tail = 1;\n');
    await cg.sync();
    expect(callersOf('g')).toEqual(before);
  });

  it('same-file call removed by the edit is not restored', async () => {
    fs.writeFileSync(path.join(dir, 'src', 'g.ts'), 'function g() { return 1; }\nfunction f() { return g(); }\n');
    await cg.sync();
    fs.writeFileSync(path.join(dir, 'src', 'g.ts'), 'function g() { return 1; }\nfunction f() { return 2; }\n');
    await cg.sync();
    expect(callersOf('g')).not.toContain('f');
  });
});

describe('sync re-synthesizes edges of rewritten files', () => {
  let dir: string;
  let cg: CodeGraph;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-sync-synth-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'child.tsx'), 'export function Child() { return null; }\n');
    fs.writeFileSync(path.join(dir, 'src', 'other.tsx'), 'export function Other() { return null; }\n');
    fs.writeFileSync(
      path.join(dir, 'src', 'app.tsx'),
      "import { Child } from './child';\nexport function App() { return <Child />; }\n",
    );
    cg = CodeGraph.initSync(dir);
    await cg.indexAll();
  });

  afterEach(() => {
    try { cg.destroy(); } catch { /* best effort */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function synthesized(): string[] {
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    try {
      return (conn.getDb().prepare(
        "SELECT json_extract(e.metadata, '$.synthesizedBy') || ':' || s.name || '>' || t.name AS k " +
        'FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target ' +
        "WHERE json_extract(e.metadata, '$.synthesizedBy') IS NOT NULL ORDER BY k",
      ).all() as Array<{ k: string }>).map((r) => r.k);
    } finally {
      conn.close();
    }
  }

  it('re-synthesizes the JSX edge of an edited component, without duplicates', async () => {
    const before = synthesized();
    expect(before).toContain('jsx-render:App>Child');
    fs.writeFileSync(
      path.join(dir, 'src', 'app.tsx'),
      "import { Child } from './child';\n\n// moved\nexport function App() { return <Child />; }\n",
    );
    await cg.sync();
    expect(synthesized()).toEqual(before);
  });

  it('keeps a synthesized edge into an edited file when a later file fails to index', async () => {
    expect(synthesized()).toContain('jsx-render:App>Child');
    fs.writeFileSync(path.join(dir, 'src', 'child.tsx'), '\n// moved\nexport function Child() { return null; }\n');
    fs.writeFileSync(path.join(dir, 'src', 'z.ts'), 'export const z = 1;\n');
    const original = ExtractionOrchestrator.prototype.indexFile;
    let childIndexed = false;
    const spy = vi.spyOn(ExtractionOrchestrator.prototype, 'indexFile').mockImplementation(
      async function (this: ExtractionOrchestrator, p: string) {
        if (p === 'src/child.tsx') {
          const r = await original.call(this, p);
          childIndexed = true;
          return r;
        }
        if (childIndexed) throw new Error('parse exploded');
        return original.call(this, p);
      },
    );
    try {
      await expect(cg.sync()).rejects.toThrow('parse exploded');
    } finally {
      spy.mockRestore();
    }
    expect(childIndexed).toBe(true);
    expect(synthesized()).toContain('jsx-render:App>Child');
  });

  it('follows the new source of an edited component, not the cached old one', async () => {
    fs.writeFileSync(
      path.join(dir, 'src', 'app.tsx'),
      "import { Other } from './other';\nexport function App() { return <Other />; }\n",
    );
    await cg.sync();
    const after = synthesized();
    expect(after).toContain('jsx-render:App>Other');
    expect(after).not.toContain('jsx-render:App>Child');
  });
});
