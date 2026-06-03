import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sduiResolver } from '../src/resolution/frameworks/sdui';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SDUI Framework Resolver', () => {
  describe('detection', () => {
    it('detects SDUI project by createRef in screen store', () => {
      const context = {
        getAllFiles: () => ['src/screens/main/store.ts', 'src/core/index.ts'],
        readFile: (p: string) =>
          p.includes('store.ts')
            ? "import { createRef } from '@/core';\nexport const state = createRef('state');"
            : null,
        getNodesByName: () => [],
        getNodesInFile: () => [],
        getProjectRoot: () => '/test',
        fileExists: () => true,
      } as any;
      expect(sduiResolver.detect(context)).toBe(true);
    });

    it('detects SDUI project by createCtx in store (no createRef)', () => {
      const context = {
        getAllFiles: () => ['src/screens/main/store.ts', 'src/core/index.ts'],
        readFile: (p: string) =>
          p.includes('store.ts')
            ? "import { createCtx } from '@/core';\nexport const ctx = createCtx<BackendContext>();"
            : null,
        getNodesByName: () => [],
        getNodesInFile: () => [],
        getProjectRoot: () => '/test',
        fileExists: () => true,
      } as any;
      expect(sduiResolver.detect(context)).toBe(true);
    });

    it('rejects non-SDUI project', () => {
      const context = {
        getAllFiles: () => ['src/index.ts'],
        readFile: () => "import express from 'express';",
        getNodesByName: () => [],
        getNodesInFile: () => [],
        getProjectRoot: () => '/test',
        fileExists: () => true,
      } as any;
      expect(sduiResolver.detect(context)).toBe(false);
    });
  });

  describe('extract', () => {
    it('emits refs for createRef string args in screen files', () => {
      const content = "const cr = createRef<X>('computed');\nconst st = createRef<Y>('state');";
      const result = sduiResolver.extract!('src/screens/main/desktop/layout/header.ts', content);
      expect(result.references).toHaveLength(2);
      expect(result.references[0]!.referenceName).toBe('__sdui_ref:computed');
      expect(result.references[1]!.referenceName).toBe('__sdui_ref:state');
    });

    it('ignores createRef in comments', () => {
      const content = [
        "// const old = createRef<X>('legacyComputed');",
        "/* createRef<Y>('disabled') */",
        "const cr = createRef<Z>('computed');",
      ].join('\n');
      const result = sduiResolver.extract!('src/screens/main/desktop/layout/header.ts', content);
      expect(result.references).toHaveLength(1);
      expect(result.references[0]!.referenceName).toBe('__sdui_ref:computed');
    });

    it('calculates correct column for createRef calls', () => {
      const content = "const pad = 'x';  createRef<X>('computed');";
      const result = sduiResolver.extract!('src/screens/main/desktop/layout/header.ts', content);
      expect(result.references).toHaveLength(1);
      expect(result.references[0]!.column).toBeGreaterThan(0);
    });

    it('skips non-screen files', () => {
      const content = "const x = createRef('test');";
      const result = sduiResolver.extract!('src/core/helpers.ts', content);
      expect(result.references).toHaveLength(0);
    });
  });

  describe('resolve', () => {
    it('resolves __sdui_ref to sibling file node', () => {
      const ref = {
        fromNodeId: 'file:store',
        referenceName: '__sdui_ref:computed',
        referenceKind: 'references' as const,
        line: 2,
        column: 0,
        filePath: 'src/screens/main/desktop/store.ts',
        language: 'typescript' as const,
      };
      const fileNode = {
        id: 'computed-file',
        kind: 'file' as const,
        name: 'computed.ts',
        filePath: 'src/screens/main/desktop/computed.ts',
        qualifiedName: 'src/screens/main/desktop/computed.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 50, startColumn: 0, endColumn: 0,
        updatedAt: Date.now(),
      };
      const context = {
        getNodesInFile: (p: string) => p.includes('computed.ts') ? [fileNode] : [],
        fileExists: (p: string) => p.endsWith('computed.ts'),
        getProjectRoot: () => '/test',
        getAllFiles: () => [],
        getNodesByName: () => [],
        readFile: () => null,
      } as any;

      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('computed-file');
    });

    it('returns null for non-sdui refs', () => {
      const ref = {
        fromNodeId: 'x',
        referenceName: 'someFunction',
        referenceKind: 'calls' as const,
        line: 1, column: 0,
        filePath: 'src/screens/main/store.ts',
        language: 'typescript' as const,
      };
      const context = {
        readFile: () => null,
        getNodesInFile: () => [],
        fileExists: () => false,
        getProjectRoot: () => '/test',
        getAllFiles: () => [],
        getNodesByName: () => [],
      } as any;
      expect(sduiResolver.resolve(ref, context)).toBeNull();
    });

    it('resolves __sdui_ref:state to store.ts (not state.ts)', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/desktop/layout/header.ts',
        referenceName: '__sdui_ref:state',
        referenceKind: 'references' as const,
        line: 28, column: 0,
        filePath: 'src/screens/main/desktop/layout/header.ts',
        language: 'typescript' as const,
      };
      const storeNode = {
        id: 'file:src/screens/main/desktop/store.ts',
        kind: 'file' as const, name: 'store.ts',
        filePath: 'src/screens/main/desktop/store.ts',
        qualifiedName: 'src/screens/main/desktop/store.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 50, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesInFile: (p: string) => p.endsWith('store.ts') ? [storeNode] : [],
        fileExists: (p: string) => p.endsWith('store.ts'),
        getProjectRoot: () => '/test',
        getAllFiles: () => [], getNodesByName: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('file:src/screens/main/desktop/store.ts');
    });

    it('resolves __sdui_ref:data to store.ts', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/desktop/layout/content.ts',
        referenceName: '__sdui_ref:data',
        referenceKind: 'references' as const,
        line: 5, column: 0,
        filePath: 'src/screens/main/desktop/layout/content.ts',
        language: 'typescript' as const,
      };
      const storeNode = {
        id: 'file:src/screens/main/desktop/store.ts',
        kind: 'file' as const, name: 'store.ts',
        filePath: 'src/screens/main/desktop/store.ts',
        qualifiedName: 'src/screens/main/desktop/store.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 50, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesInFile: (p: string) => p.endsWith('store.ts') ? [storeNode] : [],
        fileExists: (p: string) => p.endsWith('store.ts'),
        getProjectRoot: () => '/test',
        getAllFiles: () => [], getNodesByName: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('file:src/screens/main/desktop/store.ts');
    });
  });

  describe('resolve — additional coverage', () => {
    it('resolves __sdui_ref:template to store.ts', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/modules/accounts/computed.ts',
        referenceName: '__sdui_ref:template',
        referenceKind: 'references' as const,
        line: 10, column: 0,
        filePath: 'src/screens/main/modules/accounts/computed.ts',
        language: 'typescript' as const,
      };
      const storeNode = {
        id: 'file:src/screens/main/modules/accounts/store.ts',
        kind: 'file' as const, name: 'store.ts',
        filePath: 'src/screens/main/modules/accounts/store.ts',
        qualifiedName: 'src/screens/main/modules/accounts/store.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 50, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesInFile: (p: string) => p.endsWith('store.ts') ? [storeNode] : [],
        fileExists: (p: string) => p.endsWith('store.ts'),
        getProjectRoot: () => '/test',
        getAllFiles: () => [], getNodesByName: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('file:src/screens/main/modules/accounts/store.ts');
    });

    it('resolves ref to .tsx file when .ts does not exist', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/desktop/layout/header.ts',
        referenceName: '__sdui_ref:widget',
        referenceKind: 'references' as const,
        line: 5, column: 0,
        filePath: 'src/screens/main/desktop/layout/header.ts',
        language: 'typescript' as const,
      };
      const widgetNode = {
        id: 'file:src/screens/main/desktop/widget.tsx',
        kind: 'file' as const, name: 'widget.tsx',
        filePath: 'src/screens/main/desktop/widget.tsx',
        qualifiedName: 'src/screens/main/desktop/widget.tsx',
        language: 'tsx' as const,
        startLine: 1, endLine: 50, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesInFile: (p: string) => p.endsWith('widget.tsx') ? [widgetNode] : [],
        fileExists: (p: string) => p.endsWith('widget.tsx'),
        getProjectRoot: () => '/test',
        getAllFiles: () => [], getNodesByName: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('file:src/screens/main/desktop/widget.tsx');
    });

    it('resolves ref via parent directory with lower confidence', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/desktop/layout/sub/nested.ts',
        referenceName: '__sdui_ref:computed',
        referenceKind: 'references' as const,
        line: 5, column: 0,
        filePath: 'src/screens/main/desktop/layout/sub/nested.ts',
        language: 'typescript' as const,
      };
      const computedNode = {
        id: 'file:src/screens/main/desktop/layout/computed.ts',
        kind: 'file' as const, name: 'computed.ts',
        filePath: 'src/screens/main/desktop/layout/computed.ts',
        qualifiedName: 'src/screens/main/desktop/layout/computed.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 50, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesInFile: (p: string) => p.includes('computed.ts') ? [computedNode] : [],
        fileExists: (p: string) => p === 'src/screens/main/desktop/layout/computed.ts',
        getProjectRoot: () => '/test',
        getAllFiles: () => [], getNodesByName: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.confidence).toBe(0.70);
      expect(result?.targetNodeId).toBe('file:src/screens/main/desktop/layout/computed.ts');
    });
  });

  describe('resolve — screen-root scope', () => {
    it('resolves ref from deep module path to platform store.ts', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/modules/accounts/computed.ts',
        referenceName: '__sdui_ref:state',
        referenceKind: 'references' as const,
        line: 6, column: 0,
        filePath: 'src/screens/main/modules/accounts/computed.ts',
        language: 'typescript' as const,
      };
      const storeNode = {
        id: 'file:src/screens/main/desktop/store.ts',
        kind: 'file' as const, name: 'store.ts',
        filePath: 'src/screens/main/desktop/store.ts',
        qualifiedName: 'src/screens/main/desktop/store.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 50, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesInFile: (p: string) => p.endsWith('desktop/store.ts') ? [storeNode] : [],
        fileExists: (p: string) => p === 'src/screens/main/desktop/store.ts',
        getAllFiles: () => [
          'src/screens/main/desktop/store.ts',
          'src/screens/main/modules/accounts/computed.ts',
        ],
        getProjectRoot: () => '/test',
        getNodesByName: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('file:src/screens/main/desktop/store.ts');
      expect(result?.confidence).toBeLessThanOrEqual(0.65);
    });

    it('resolves template ref from module to desktop/store.ts', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/modules/offers/computed.ts',
        referenceName: '__sdui_ref:template',
        referenceKind: 'references' as const,
        line: 7, column: 0,
        filePath: 'src/screens/main/modules/offers/computed.ts',
        language: 'typescript' as const,
      };
      const storeNode = {
        id: 'file:src/screens/main/desktop/store.ts',
        kind: 'file' as const, name: 'store.ts',
        filePath: 'src/screens/main/desktop/store.ts',
        qualifiedName: 'src/screens/main/desktop/store.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 100, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesInFile: (p: string) => p.endsWith('desktop/store.ts') ? [storeNode] : [],
        fileExists: (p: string) => p === 'src/screens/main/desktop/store.ts',
        getAllFiles: () => ['src/screens/main/desktop/store.ts'],
        getProjectRoot: () => '/test',
        getNodesByName: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('file:src/screens/main/desktop/store.ts');
    });
  });

  describe('extract — self-reference filtering', () => {
    it('skips createRef in store.ts files (definitions, not references)', () => {
      const content = "export const state = createRef<DesktopState>('state');\nexport const data = createRef<DesktopData>('data');";
      const result = sduiResolver.extract!('src/screens/main/desktop/store.ts', content);
      const refRefs = result.references.filter((r: any) => r.referenceName.startsWith('__sdui_ref:'));
      expect(refRefs).toHaveLength(0);
    });

    it('skips self-referencing createRef (computed.ts with createRef("computed"))', () => {
      const content = "const cr = createRef<DesktopComputed>('computed');\nconst state = createRef<DesktopState>('state');";
      const result = sduiResolver.extract!('src/screens/main/desktop/computed.ts', content);
      expect(result.references).toHaveLength(1);
      expect(result.references[0]!.referenceName).toBe('__sdui_ref:state');
    });

    it('emits refs from layout files (references, not definitions)', () => {
      const content = "const cr = createRef<DesktopComputed>('computed');\nconst state = createRef<DesktopState>('state');";
      const result = sduiResolver.extract!('src/screens/main/desktop/layout/header.ts', content);
      expect(result.references).toHaveLength(2);
      expect(result.references[0]!.referenceName).toBe('__sdui_ref:computed');
      expect(result.references[1]!.referenceName).toBe('__sdui_ref:state');
    });
  });

  describe('component node emission', () => {
    it('does not emit component node for non-screen files', () => {
      const content = "const x = createRef('test');";
      const result = sduiResolver.extract!('src/core/helpers.ts', content);
      expect(result.nodes).toHaveLength(0);
    });

    it('does not emit component node for store.ts', () => {
      const content = "export const state = createRef<S>('state');";
      const result = sduiResolver.extract!('src/screens/main/desktop/store.ts', content);
      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('createCtx resolution', () => {
    it('emits ref for createCtx calls', () => {
      const content = [
        "import { createCtx } from '../store';",
        "const ctx = createCtx<BackendContext>();",
        "export function header() { return ctx.accounts; }",
      ].join('\n');
      const result = sduiResolver.extract!(
        'src/screens/main/desktop/layout/header.ts',
        content
      );
      const ctxRefs = result.references.filter(
        (r: any) => r.referenceName.startsWith('__sdui_ctx:')
      );
      expect(ctxRefs).toHaveLength(1);
      expect(ctxRefs[0]!.referenceName).toBe('__sdui_ctx:BackendContext');
    });

    it('resolves __sdui_ctx:BackendContext to file containing the type', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/desktop/layout/header.ts',
        referenceName: '__sdui_ctx:BackendContext',
        referenceKind: 'references' as const,
        line: 2, column: 0,
        filePath: 'src/screens/main/desktop/layout/header.ts',
        language: 'typescript' as const,
      };
      const targetNode = {
        id: 'file:src/screens/main/modules/store/backend-context.ts',
        kind: 'file' as const, name: 'backend-context.ts',
        filePath: 'src/screens/main/modules/store/backend-context.ts',
        qualifiedName: 'src/screens/main/modules/store/backend-context.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 200, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const typeNode = {
        id: 'type:BackendContext',
        kind: 'type_alias' as const, name: 'BackendContext',
        filePath: 'src/screens/main/modules/store/backend-context.ts',
        qualifiedName: 'BackendContext',
        language: 'typescript' as const,
        startLine: 10, endLine: 50, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesByName: (name: string) => name === 'BackendContext' ? [typeNode] : [],
        getNodesInFile: (p: string) => p.includes('backend-context') ? [targetNode, typeNode] : [],
        fileExists: (p: string) => p.includes('backend-context'),
        getProjectRoot: () => '/test',
        getAllFiles: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('file:src/screens/main/modules/store/backend-context.ts');
      expect(result?.confidence).toBe(0.75);
    });

    it('ignores createCtx in comments', () => {
      const content = [
        "// const ctx = createCtx<OldContext>();",
        "const ctx = createCtx<BackendContext>();",
      ].join('\n');
      const result = sduiResolver.extract!(
        'src/screens/main/desktop/layout/header.ts',
        content
      );
      const ctxRefs = result.references.filter(
        (r: any) => r.referenceName.startsWith('__sdui_ctx:')
      );
      expect(ctxRefs).toHaveLength(1);
      expect(ctxRefs[0]!.referenceName).toBe('__sdui_ctx:BackendContext');
    });
  });

  describe('createCtx — self-ref prevention', () => {
    it('returns null for createCtx self-reference (type defined in same file)', () => {
      const ref = {
        fromNodeId: 'file:src/screens/main/modules/store/backend-context.ts',
        referenceName: '__sdui_ctx:BackendContext',
        referenceKind: 'references' as const,
        line: 195, column: 0,
        filePath: 'src/screens/main/modules/store/backend-context.ts',
        language: 'typescript' as const,
      };
      const typeNode = {
        id: 'type:BackendContext',
        kind: 'type_alias' as const, name: 'BackendContext',
        filePath: 'src/screens/main/modules/store/backend-context.ts',
        qualifiedName: 'BackendContext',
        language: 'typescript' as const,
        startLine: 10, endLine: 50, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const fileNode = {
        id: 'file:src/screens/main/modules/store/backend-context.ts',
        kind: 'file' as const, name: 'backend-context.ts',
        filePath: 'src/screens/main/modules/store/backend-context.ts',
        qualifiedName: 'src/screens/main/modules/store/backend-context.ts',
        language: 'typescript' as const,
        startLine: 1, endLine: 200, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
      };
      const context = {
        getNodesByName: (name: string) => name === 'BackendContext' ? [typeNode] : [],
        getNodesInFile: (p: string) => p.includes('backend-context') ? [fileNode, typeNode] : [],
        fileExists: () => false,
        getProjectRoot: () => '/test',
        getAllFiles: () => [], readFile: () => null,
      } as any;
      const result = sduiResolver.resolve(ref, context);
      expect(result).toBeNull();
    });
  });

  describe('store.ts createCtx extraction', () => {
    it('emits createCtx ref from store.ts but skips createRef', () => {
      const content = [
        "export const ctx = createCtx<BackendContext>();",
        "export const state = createRef<DesktopState>('state');",
        "export const data = createRef<DesktopData>('data');",
      ].join('\n');
      const result = sduiResolver.extract!('src/screens/main/desktop/store.ts', content);
      const refRefs = result.references.filter((r: any) => r.referenceName.startsWith('__sdui_ref:'));
      const ctxRefs = result.references.filter((r: any) => r.referenceName.startsWith('__sdui_ctx:'));
      expect(refRefs).toHaveLength(0);
      expect(ctxRefs).toHaveLength(1);
      expect(ctxRefs[0]!.referenceName).toBe('__sdui_ctx:BackendContext');
    });
  });

  describe('integration — sync re-detects frameworks on new files', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-sdui-sync-'));
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/index.ts'),
        "export const app = 'hello';\n"
      );
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detects SDUI after sync when screens are added post-init', async () => {
      const { CodeGraph } = await import('../src/index');
      const cg = await CodeGraph.init(tmpDir);
      try {
        await cg.indexAll();
        expect(cg.getDetectedFrameworks()).not.toContain('sdui');

        const screenDir = path.join(tmpDir, 'src/screens/main/desktop');
        const layoutDir = path.join(screenDir, 'layout');
        fs.mkdirSync(layoutDir, { recursive: true });
        fs.writeFileSync(path.join(screenDir, 'store.ts'),
          "import { createRef } from './core';\n" +
          "export const state = createRef<State>('state');\n"
        );
        fs.writeFileSync(path.join(screenDir, 'computed.ts'),
          "export function computed() { return {}; }\n"
        );
        fs.writeFileSync(path.join(layoutDir, 'header.ts'),
          "import { createRef } from '../../core';\n" +
          "const cr = createRef<Computed>('computed');\n" +
          "export function header() { return cr; }\n"
        );

        await cg.sync();

        expect(cg.getDetectedFrameworks()).toContain('sdui');

        const queries = (cg as any).queries;
        const headerFile = queries.getNodesByFile('src/screens/main/desktop/layout/header.ts')
          .find((n: any) => n.kind === 'file');
        expect(headerFile).toBeDefined();

        const outgoing = queries.getOutgoingEdges(headerFile!.id);
        const fwEdges = outgoing.filter((e: any) => e.metadata?.resolvedBy === 'framework');
        expect(fwEdges.length).toBeGreaterThan(0);
      } finally {
        cg.close();
      }
    });
  });

  describe('integration — full pipeline', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-sdui-'));
      const screenDir = path.join(tmpDir, 'src/screens/main/desktop');
      const layoutDir = path.join(screenDir, 'layout');
      fs.mkdirSync(layoutDir, { recursive: true });

      fs.writeFileSync(path.join(screenDir, 'store.ts'),
        "import { createRef } from './core';\n" +
        "export const state = createRef<State>('state');\n" +
        "export const data = createRef<Data>('data');\n" +
        "export function desktopData() { return {}; }\n"
      );

      fs.writeFileSync(path.join(screenDir, 'computed.ts'),
        "import { state } from './store';\n" +
        "export function desktopComputed() { return {}; }\n"
      );

      fs.writeFileSync(path.join(layoutDir, 'header.ts'),
        "import { createRef } from '../../core';\n" +
        "const cr = createRef<Computed>('computed');\n" +
        "const st = createRef<State>('state');\n" +
        "export function header() { return {}; }\n"
      );
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates edges from layout/header.ts to the producer functions in computed.ts and store.ts after full init', async () => {
      const { CodeGraph } = await import('../src/index');
      const cg = await CodeGraph.init(tmpDir);
      try {
        await cg.indexAll();

        const queries = (cg as any).queries;
        const headerFileNode = queries.getNodesByFile('src/screens/main/desktop/layout/header.ts')
          .find((n: any) => n.kind === 'file');
        expect(headerFileNode).toBeDefined();

        const outgoing = queries.getOutgoingEdges(headerFileNode!.id);
        const frameworkEdges = outgoing.filter(
          (e: any) => e.metadata?.resolvedBy === 'framework'
        );

        expect(frameworkEdges.length).toBeGreaterThan(0);

        // #13: createRef edges now retarget from the sibling FILE node to the
        // exported producer FUNCTION in that file (desktopComputed / desktopData),
        // so the flow connects layout -> producer end-to-end.
        const targetNodes = frameworkEdges
          .map((e: any) => queries.getNodeById(e.target))
          .filter(Boolean);
        const computedProducer = targetNodes.find(
          (n: any) => n.kind === 'function' && n.name === 'desktopComputed' && n.filePath.includes('computed.ts')
        );
        const storeProducer = targetNodes.find(
          (n: any) => n.kind === 'function' && n.name === 'desktopData' && n.filePath.includes('store.ts')
        );
        expect(computedProducer).toBeDefined();
        expect(storeProducer).toBeDefined();
      } finally {
        cg.close();
      }
    });
  });
});
