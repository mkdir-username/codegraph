import type { FrameworkResolver, ResolvedRef, UnresolvedRef, ResolutionContext } from '../types';

function extractCreateRefArgs(content: string): string[] {
  const re = /createRef[^(]*\(\s*['"](\w+)['"]/g;
  const args: string[] = [];
  let m;
  while ((m = re.exec(content)) !== null) args.push(m[1]!);
  return args;
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

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceName !== 'createRef') return null;
    const content = context.readFile(ref.filePath);
    if (!content) return null;

    const args = extractCreateRefArgs(content);
    if (args.length === 0) return null;

    const dir = ref.filePath.replace(/\/[^/]+$/, '');
    for (const arg of args) {
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
    }
    return null;
  },
};
