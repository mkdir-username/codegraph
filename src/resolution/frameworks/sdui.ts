import type { Node } from '../../types';
import type { FrameworkResolver, ResolvedRef, UnresolvedRef, ResolutionContext, FrameworkExtractionResult } from '../types';
import { stripCommentsForRegex } from '../strip-comments';

const SDUI_REF_PREFIX = '__sdui_ref:';
const SDUI_CTX_PREFIX = '__sdui_ctx:';

const REF_TO_FILE: Record<string, string> = {
  state: 'store.ts',
  data: 'store.ts',
  template: 'store.ts',
};

function extractCreateRefCalls(content: string): Array<{ arg: string; line: number; column: number }> {
  const re = /createRef[^(]*\(\s*['"](\w+)['"]/g;
  const results: Array<{ arg: string; line: number; column: number }> = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    const before = content.slice(0, m.index);
    const line = before.split('\n').length;
    const lastNewline = before.lastIndexOf('\n');
    const column = lastNewline === -1 ? m.index : m.index - lastNewline - 1;
    results.push({ arg: m[1]!, line, column });
  }
  return results;
}

function extractCreateCtxCalls(content: string): Array<{ typeName: string; line: number; column: number }> {
  const re = /createCtx<(\w+)>\s*\(\)/g;
  const results: Array<{ typeName: string; line: number; column: number }> = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    const before = content.slice(0, m.index);
    const line = before.split('\n').length;
    const lastNewline = before.lastIndexOf('\n');
    const column = lastNewline === -1 ? m.index : m.index - lastNewline - 1;
    results.push({ typeName: m[1]!, line, column });
  }
  return results;
}

export const sduiResolver: FrameworkResolver = {
  name: 'sdui',
  languages: ['typescript'],

  detect(context: ResolutionContext): boolean {
    const files = context.getAllFiles();
    const storeFiles = files.filter(
      (f: string) => f.endsWith('/store.ts') && f.includes('src/screens/'),
    );
    for (const sf of storeFiles.slice(0, 3)) {
      const content = context.readFile(sf);
      if (content && content.includes('createRef')) return true;
    }
    return false;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];

    if (!filePath.includes('src/screens/')) return { nodes, references };
    if (filePath.endsWith('/store.ts')) return { nodes, references };

    const safe = stripCommentsForRegex(content, 'typescript');
    const calls = extractCreateRefCalls(safe);
    const ctxCalls = extractCreateCtxCalls(safe);
    if (calls.length === 0 && ctxCalls.length === 0) return { nodes, references };

    const fileNodeId = `file:${filePath}`;
    const basename = filePath.replace(/^.*\//, '').replace(/\.\w+$/, '');
    const lang = filePath.endsWith('.tsx') ? 'tsx' as const : 'typescript' as const;

    if (calls.length > 0) {
      const screenMatch = filePath.match(/src\/screens\/([^/]+)\//);
      if (screenMatch) {
        const screenName = screenMatch[1]!;
        const platformMatch = filePath.match(/src\/screens\/[^/]+\/(\w+)\//);
        const platform = platformMatch ? platformMatch[1]! : 'default';
        nodes.push({
          id: `component:${screenName}/${platform}`,
          kind: 'component',
          name: `${screenName}/${platform}`,
          qualifiedName: `sdui:${screenName}/${platform}`,
          filePath,
          language: lang,
          startLine: 1,
          endLine: calls[calls.length - 1]!.line,
          startColumn: 0,
          endColumn: 0,
          updatedAt: Date.now(),
        });
      }

      for (const { arg, line, column } of calls) {
        if (arg === basename) continue;
        references.push({
          fromNodeId: fileNodeId,
          referenceName: SDUI_REF_PREFIX + arg,
          referenceKind: 'references',
          line,
          column,
          filePath,
          language: lang,
        });
      }
    }

    for (const { typeName, line, column } of ctxCalls) {
      references.push({
        fromNodeId: fileNodeId,
        referenceName: SDUI_CTX_PREFIX + typeName,
        referenceKind: 'references',
        line,
        column,
        filePath,
        language: lang,
      });
    }

    return { nodes, references };
  },

  claimsReference(name: string): boolean {
    return name.startsWith(SDUI_REF_PREFIX) || name.startsWith(SDUI_CTX_PREFIX);
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceName.startsWith(SDUI_CTX_PREFIX)) {
      const typeName = ref.referenceName.slice(SDUI_CTX_PREFIX.length);
      const typeNodes = context.getNodesByName(typeName);
      if (typeNodes.length > 0) {
        const typeNode = typeNodes[0]!;
        const fileNodes = context.getNodesInFile(typeNode.filePath);
        const fileNode = fileNodes.find((n) => n.kind === 'file');
        if (fileNode) {
          return {
            original: ref,
            targetNodeId: fileNode.id,
            confidence: 0.75,
            resolvedBy: 'framework',
          };
        }
      }
      return null;
    }
    if (!ref.referenceName.startsWith(SDUI_REF_PREFIX)) return null;
    const arg = ref.referenceName.slice(SDUI_REF_PREFIX.length);
    const targetNames = REF_TO_FILE[arg]
      ? [REF_TO_FILE[arg]!]
      : [`${arg}.ts`, `${arg}.tsx`];
    const dir = ref.filePath.replace(/\/[^/]+$/, '');
    const parentDir = dir.replace(/\/[^/]+$/, '');

    for (const base of [dir, parentDir]) {
      for (const targetName of targetNames) {
        const candidate = base + '/' + targetName;
        if (context.fileExists(candidate)) {
          const nodes = context.getNodesInFile(candidate);
          const fileNode = nodes.find((n) => n.kind === 'file');
          if (fileNode) {
            return {
              original: ref,
              targetNodeId: fileNode.id,
              confidence: base === dir ? 0.80 : 0.70,
              resolvedBy: 'framework',
            };
          }
        }
      }
    }
    return null;
  },
};
