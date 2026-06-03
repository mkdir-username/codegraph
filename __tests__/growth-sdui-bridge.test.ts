import { describe, it, expect } from 'vitest';
import { sduiResolver } from '../src/resolution/frameworks/sdui';

function makeFileNode(filePath: string, name: string) {
  return {
    id: `file:${filePath}`,
    kind: 'file' as const,
    name,
    filePath,
    qualifiedName: filePath,
    language: 'typescript' as const,
    startLine: 1,
    endLine: 200,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}

function makeFnNode(filePath: string, name: string, startLine: number) {
  return {
    id: `fn:${filePath}:${name}`,
    kind: 'function' as const,
    name,
    filePath,
    qualifiedName: name,
    language: 'typescript' as const,
    startLine,
    endLine: startLine + 20,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}

describe('SDUI bridge — retarget createRef edge to producer function (#13)', () => {
  it('retargets __sdui_ref:data from store.ts file node to exported desktopData producer', () => {
    const storePath = 'src/screens/main/desktop/store.ts';
    const fileNode = makeFileNode(storePath, 'store.ts');
    const desktopData = makeFnNode(storePath, 'desktopData', 104);
    // store.ts has multiple exported fns — not a single-export heuristic
    const otherFn = makeFnNode(storePath, 'helperReducer', 10);
    const anotherFn = makeFnNode(storePath, 'desktopState', 40);

    const ref = {
      fromNodeId: 'file:src/screens/main/desktop/layout/content.ts',
      referenceName: '__sdui_ref:data',
      referenceKind: 'references' as const,
      line: 5,
      column: 0,
      filePath: 'src/screens/main/desktop/layout/content.ts',
      language: 'typescript' as const,
    };
    const context = {
      getNodesInFile: (p: string) =>
        p.endsWith('store.ts') ? [fileNode, otherFn, anotherFn, desktopData] : [],
      fileExists: (p: string) => p.endsWith('store.ts'),
      getProjectRoot: () => '/test',
      getAllFiles: () => [],
      getNodesByName: () => [],
      readFile: () => null,
    } as any;

    const result = sduiResolver.resolve(ref, context);
    expect(result).not.toBeNull();
    expect(result?.targetNodeId).toBe(desktopData.id);
    expect(result?.targetNodeId).not.toBe(fileNode.id);
    expect(result?.resolvedBy).toBe('framework');
  });

  it('retargets __sdui_ref:computed to exported desktopComputed producer in computed.ts', () => {
    const computedPath = 'src/screens/main/desktop/computed.ts';
    const fileNode = makeFileNode(computedPath, 'computed.ts');
    const desktopComputed = makeFnNode(computedPath, 'desktopComputed', 22);

    const ref = {
      fromNodeId: 'file:src/screens/main/desktop/layout/header.ts',
      referenceName: '__sdui_ref:computed',
      referenceKind: 'references' as const,
      line: 3,
      column: 0,
      filePath: 'src/screens/main/desktop/layout/header.ts',
      language: 'typescript' as const,
    };
    const context = {
      getNodesInFile: (p: string) =>
        p.endsWith('computed.ts') ? [fileNode, desktopComputed] : [],
      fileExists: (p: string) => p.endsWith('computed.ts'),
      getProjectRoot: () => '/test',
      getAllFiles: () => [],
      getNodesByName: () => [],
      readFile: () => null,
    } as any;

    const result = sduiResolver.resolve(ref, context);
    expect(result).not.toBeNull();
    expect(result?.targetNodeId).toBe(desktopComputed.id);
  });

  it('falls back to file node when no matching producer function exists', () => {
    const storePath = 'src/screens/main/desktop/store.ts';
    const fileNode = makeFileNode(storePath, 'store.ts');
    const unrelated = makeFnNode(storePath, 'someOtherThing', 10);

    const ref = {
      fromNodeId: 'file:src/screens/main/desktop/layout/content.ts',
      referenceName: '__sdui_ref:data',
      referenceKind: 'references' as const,
      line: 5,
      column: 0,
      filePath: 'src/screens/main/desktop/layout/content.ts',
      language: 'typescript' as const,
    };
    const context = {
      getNodesInFile: (p: string) =>
        p.endsWith('store.ts') ? [fileNode, unrelated] : [],
      fileExists: (p: string) => p.endsWith('store.ts'),
      getProjectRoot: () => '/test',
      getAllFiles: () => [],
      getNodesByName: () => [],
      readFile: () => null,
    } as any;

    const result = sduiResolver.resolve(ref, context);
    expect(result).not.toBeNull();
    expect(result?.targetNodeId).toBe(fileNode.id);
  });
});
