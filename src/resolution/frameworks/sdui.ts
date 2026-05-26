import type { Node } from '../../types';
import type { FrameworkResolver, ResolvedRef, UnresolvedRef, ResolutionContext, FrameworkExtractionResult } from '../types';

const SDUI_REF_PREFIX = '__sdui_ref:';

function extractCreateRefCalls(content: string): Array<{ arg: string; line: number }> {
  const re = /createRef[^(]*\(\s*['"](\w+)['"]/g;
  const results: Array<{ arg: string; line: number }> = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    const line = content.slice(0, m.index).split('\n').length;
    results.push({ arg: m[1]!, line });
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

    const calls = extractCreateRefCalls(content);
    if (calls.length === 0) return { nodes, references };

    const fileNodeId = `file:${filePath}:file:${filePath.split('/').pop()}:1`;
    const lang = filePath.endsWith('.tsx') ? 'tsx' as const : 'typescript' as const;
    for (const { arg, line } of calls) {
      references.push({
        fromNodeId: fileNodeId,
        referenceName: SDUI_REF_PREFIX + arg,
        referenceKind: 'references',
        line,
        column: 0,
        filePath,
        language: lang,
      });
    }
    return { nodes, references };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (!ref.referenceName.startsWith(SDUI_REF_PREFIX)) return null;
    const arg = ref.referenceName.slice(SDUI_REF_PREFIX.length);
    const dir = ref.filePath.replace(/\/[^/]+$/, '');
    const sibling = dir + '/' + arg + '.ts';

    if (context.fileExists(sibling)) {
      const nodes = context.getNodesInFile(sibling);
      const fileNode = nodes.find((n) => n.kind === 'file');
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
  },
};
