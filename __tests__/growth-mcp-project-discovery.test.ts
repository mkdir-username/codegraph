/**
 * Growth backlog — "No CodeGraph project is loaded" was a dead end.
 *
 * Eight of the twenty-one failed codegraph calls in one local transcript corpus
 * were this error or its sibling "not initialized". Both told the agent what to
 * pass without telling it what exists, so the agent went back to the shell. The
 * error now carries the indexed projects it can actually see, and the
 * uninitialized one names the command that fixes it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findIndexedProjectsNear } from '../src/directory';
import { ToolHandler } from '../src/mcp/tools';

let home: string;

function fakeProject(root: string): void {
  fs.mkdirSync(path.join(root, '.codegraph'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codegraph', 'codegraph.db'), '');
}

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-discovery-')));
  fakeProject(path.join(home, 'Docs', 'alpha'));
  fakeProject(path.join(home, 'Docs', 'beta'));
  fs.mkdirSync(path.join(home, 'Docs', 'plain', 'src'), { recursive: true });
  fakeProject(path.join(home, 'Docs', 'alpha', 'node_modules', 'nested'));
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('findIndexedProjectsNear', () => {
  it('находит проиндексированные проекты на глубине до 3', () => {
    const found = findIndexedProjectsNear(home);
    expect(found).toContain(path.join(home, 'Docs', 'alpha'));
    expect(found).toContain(path.join(home, 'Docs', 'beta'));
  });

  it('не возвращает каталоги без индекса', () => {
    expect(findIndexedProjectsNear(home)).not.toContain(path.join(home, 'Docs', 'plain'));
  });

  it('не спускается внутрь найденного проекта и в node_modules', () => {
    expect(findIndexedProjectsNear(home).some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('держит потолок по числу результатов', () => {
    expect(findIndexedProjectsNear(home, { maxResults: 1 })).toHaveLength(1);
  });

  it('уважает лимит глубины', () => {
    expect(findIndexedProjectsNear(home, { maxDepth: 1 })).toEqual([]);
  });
});

describe('ошибка про незагруженный проект', () => {
  it('перечисляет индексы, которые видно рядом', async () => {
    const handler = new ToolHandler(null);
    handler.setDefaultProjectHint(home);
    const result = await handler.execute('codegraph_status', {});
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('No CodeGraph project is loaded');
    expect(text).toContain(path.join(home, 'Docs', 'alpha'));
    expect(text).toContain('projectPath');
  });
});

describe('not initialized', () => {
  it('называет команду индексации и её цену, а не только факт отсутствия', async () => {
    const plain = path.join(home, 'Docs', 'plain');
    const handler = new ToolHandler(null);
    const result = await handler.execute('codegraph_search', { query: 'x', projectPath: plain });
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain(`codegraph init ${plain}`);
    expect(text).toMatch(/second/i);
  });
});
