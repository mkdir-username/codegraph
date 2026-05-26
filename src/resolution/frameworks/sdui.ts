import type { Node } from '../../types';
import type { FrameworkResolver, ResolvedRef, UnresolvedRef, ResolutionContext, FrameworkExtractionResult } from '../types';
import { stripCommentsForRegex } from '../strip-comments';

const SDUI_REF_PREFIX = '__sdui_ref:';
const SDUI_CTX_PREFIX = '__sdui_ctx:';

const REF_TO_FILE: Record<string, string> = {
  state: 'store.ts',
  data: 'store.ts',
  template: 'store.ts',
  computed: 'computed.ts',
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
    const screenRootMatch = ref.filePath.match(/^(.*src\/screens\/[^/]+)\//);
    const screenRoot = screenRootMatch ? screenRootMatch[1]! : null;

    const searchDirs: string[] = [dir];
    let current = dir;
    while (current !== screenRoot && current.includes('/')) {
      current = current.replace(/\/[^/]+$/, '');
      searchDirs.push(current);
    }

    if (screenRoot) {
      const allFiles = context.getAllFiles();
      const platformDirs = new Set<string>();
      const prefix = screenRoot + '/';
      for (const f of allFiles) {
        if (f.startsWith(prefix)) {
          const seg = f.slice(prefix.length).split('/')[0];
          if (seg && !seg.includes('.')) platformDirs.add(prefix + seg);
        }
      }
      for (const pd of platformDirs) {
        if (!searchDirs.includes(pd)) searchDirs.push(pd);
      }
    }

    for (const base of searchDirs) {
      for (const targetName of targetNames) {
        const candidate = base + '/' + targetName;
        if (context.fileExists(candidate)) {
          const nodes = context.getNodesInFile(candidate);
          const fileNode = nodes.find((n) => n.kind === 'file');
          if (fileNode) {
            const isLocal = base === dir;
            const isParent = base === dir.replace(/\/[^/]+$/, '');
            const confidence = isLocal ? 0.80 : isParent ? 0.70 : 0.60;
            return {
              original: ref,
              targetNodeId: fileNode.id,
              confidence,
              resolvedBy: 'framework',
            };
          }
        }
      }
    }
    return null;
  },
};
