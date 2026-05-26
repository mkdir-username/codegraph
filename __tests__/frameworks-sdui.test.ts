import { describe, it, expect } from 'vitest';
import { sduiResolver } from '../src/resolution/frameworks/sdui';

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
      const content = "export const cr = createRef<X>('computed');\nexport const st = createRef<Y>('state');";
      const result = sduiResolver.extract!('src/screens/main/desktop/store.ts', content);
      expect(result.references).toHaveLength(2);
      expect(result.references[0]!.referenceName).toBe('__sdui_ref:computed');
      expect(result.references[1]!.referenceName).toBe('__sdui_ref:state');
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
  });
});
