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

  describe('createRef resolution', () => {
    it('resolves createRef string arg to sibling file node', () => {
      const ref = {
        fromNodeId: 'store-node',
        referenceName: 'createRef',
        referenceKind: 'calls' as const,
        line: 10,
        column: 20,
        filePath: 'src/screens/main/desktop/store.ts',
        language: 'typescript' as const,
      };
      const computedNode = {
        id: 'computed-file',
        kind: 'file' as const,
        name: 'computed.ts',
        qualifiedName: 'src/screens/main/desktop/computed.ts',
        filePath: 'src/screens/main/desktop/computed.ts',
        language: 'typescript' as const,
        startLine: 1,
        endLine: 50,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      };
      const context = {
        readFile: (p: string) =>
          p.includes('store.ts')
            ? "export const cr = createRef<X>('computed');\nexport const st = createRef<Y>('state');"
            : null,
        getNodesInFile: (p: string) =>
          p.includes('computed.ts') ? [computedNode] : [],
        fileExists: (p: string) =>
          p.endsWith('computed.ts') || p.endsWith('state.ts'),
        getProjectRoot: () => '/test',
        getAllFiles: () => [],
        getNodesByName: () => [],
      } as any;

      const result = sduiResolver.resolve(ref, context);
      expect(result).not.toBeNull();
      expect(result?.targetNodeId).toBe('computed-file');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('returns null for non-createRef calls', () => {
      const ref = {
        fromNodeId: 'node',
        referenceName: 'someOtherFunction',
        referenceKind: 'calls' as const,
        line: 1,
        column: 0,
        filePath: 'src/screens/main/store.ts',
        language: 'typescript' as const,
      };
      const context = {
        readFile: () => 'const x = someOtherFunction();',
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
