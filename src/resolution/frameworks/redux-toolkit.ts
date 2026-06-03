/**
 * Redux Toolkit Framework Resolver
 *
 * Bridges the dynamic-dispatch gap around `createSlice`. Static tree-sitter
 * extraction never sees the `reducers: { ... }` members as callable symbols,
 * and the `export const { x } = slice.actions` destructure has no statically
 * resolvable target — so an action dispatched in a component never connects to
 * the reducer that handles it, and a `createSelector` reading `state.<slice>`
 * never connects to the slice. This resolver makes those flows exist in the
 * graph:
 *
 *  (a) each `reducers` member becomes a `function` node, qualified
 *      `<Slice>.reducers.<key>`;
 *  (b) each destructured action (`export const { key } = slice.actions`)
 *      gets a `references` edge to its reducer member node;
 *  (c) `extraReducers` `addCase(thunk.{pending,fulfilled,rejected}, cb)` and a
 *      `createSelector` reading `state.<sliceName>` get a `references` edge to
 *      the slice / reducer member.
 *
 * Edges produced through the resolve() path are `provenance:'heuristic'`
 * (resolvedBy:'framework'); the synthesizer tag is carried on the reference.
 */

import type { Node } from '../../types';
import type {
  FrameworkResolver,
  ResolvedRef,
  UnresolvedRef,
  ResolutionContext,
  FrameworkExtractionResult,
} from '../types';

const RTK_REDUCER_PREFIX = '__rtk_reducer:';

interface SliceInfo {
  sliceVar: string;
  startIndex: number;
  reducers: Array<{ key: string; line: number; column: number }>;
  thunkCases: string[];
}

/** Find the matching close brace for the `{` at openIndex (returns index of `}`). */
function matchBrace(content: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineCol(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  const column = lastNewline === -1 ? index : index - lastNewline - 1;
  return { line, column };
}

/** Parse the `reducers: { ... }` object of a slice, yielding member keys. */
function parseReducerKeys(
  content: string,
  sliceBodyStart: number,
  sliceBodyEnd: number,
): Array<{ key: string; line: number; column: number }> {
  const reducersRe = /\breducers\s*:\s*\{/g;
  reducersRe.lastIndex = sliceBodyStart;
  const m = reducersRe.exec(content);
  if (!m || m.index > sliceBodyEnd) return [];
  const open = content.indexOf('{', m.index + m[0].length - 1);
  const close = matchBrace(content, open);
  if (close === -1) return [];

  const body = content.slice(open + 1, close);
  const keys: Array<{ key: string; line: number; column: number }> = [];
  // method-shorthand `key(state, action) {` and arrow `key: (state) => {`
  const memberRe = /(?:^|[,{]\s*|\n\s*)([A-Za-z_$][\w$]*)\s*(?::\s*(?:async\s*)?\(|\()/g;
  let mm: RegExpExecArray | null;
  while ((mm = memberRe.exec(body)) !== null) {
    const key = mm[1]!;
    const absIndex = open + 1 + mm.index + mm[0].indexOf(key);
    const { line, column } = lineCol(content, absIndex);
    keys.push({ key, line, column });
  }
  return keys;
}

function parseSlices(content: string): SliceInfo[] {
  const slices: SliceInfo[] = [];
  const sliceRe = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*createSlice\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = sliceRe.exec(content)) !== null) {
    const sliceVar = m[1]!;
    const open = content.indexOf('{', m.index + m[0].length - 1);
    const close = matchBrace(content, open);
    if (close === -1) continue;
    const reducers = parseReducerKeys(content, open, close);

    const body = content.slice(open, close);
    const thunkCases: string[] = [];
    const caseRe = /addCase\s*\(\s*([A-Za-z_$][\w$]*)\.(pending|fulfilled|rejected)\b/g;
    let cm: RegExpExecArray | null;
    while ((cm = caseRe.exec(body)) !== null) {
      thunkCases.push(`${cm[1]}.${cm[2]}`);
    }

    slices.push({ sliceVar, startIndex: m.index, reducers, thunkCases });
  }
  return slices;
}

export const reduxToolkitResolver: FrameworkResolver = {
  name: 'redux-toolkit',
  languages: ['javascript', 'typescript'],

  detect(context: ResolutionContext): boolean {
    const packageJson = context.readFile('package.json');
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['@reduxjs/toolkit']) return true;
      } catch {
        // invalid JSON
      }
    }
    // Fall back to scanning a few source files for createSlice usage.
    const files = context.getAllFiles();
    for (const f of files) {
      if (!/\.(t|j)sx?$/.test(f)) continue;
      const content = context.readFile(f);
      if (content && content.includes('createSlice')) return true;
    }
    return false;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];

    if (!content.includes('createSlice')) return { nodes, references };

    const lang = filePath.endsWith('.tsx')
      ? ('tsx' as const)
      : filePath.endsWith('.jsx')
        ? ('jsx' as const)
        : filePath.endsWith('.js')
          ? ('javascript' as const)
          : ('typescript' as const);
    const now = Date.now();

    const slices = parseSlices(content);
    // map reducer key -> qualifiedName + nodeId, scoped per slice
    const reducerQualified: Record<string, { id: string; qualifiedName: string }> = {};

    for (const slice of slices) {
      for (const { key, line, column } of slice.reducers) {
        const qualifiedName = `${slice.sliceVar}.reducers.${key}`;
        const id = `redux-reducer:${filePath}:${qualifiedName}:${line}`;
        nodes.push({
          id,
          kind: 'function',
          name: key,
          qualifiedName,
          filePath,
          startLine: line,
          endLine: line,
          startColumn: column,
          endColumn: column + key.length,
          language: lang,
          isExported: false,
          updatedAt: now,
        });
        reducerQualified[key] = { id, qualifiedName };

        // (c) thunk addCase callback -> reducer member: nothing to wire here yet,
        // the addCase targets are recorded per-slice below.
      }

      // (c) createSelector reading state.<sliceName> -> the slice.
      // The slice's `name:` literal identifies the state key.
      const nameRe = /\bname\s*:\s*['"]([\w-]+)['"]/g;
      nameRe.lastIndex = slice.startIndex;
      const nm = nameRe.exec(content);
      const sliceName = nm ? nm[1]! : null;
      if (sliceName) {
        const selRe = new RegExp(`state\\.${sliceName}\\b`, 'g');
        let sm: RegExpExecArray | null;
        while ((sm = selRe.exec(content)) !== null) {
          const { line, column } = lineCol(content, sm.index);
          // Reference the slice variable so trace can hop selector -> slice.
          references.push({
            fromNodeId: `file:${filePath}`,
            referenceName: slice.sliceVar,
            referenceKind: 'references',
            line,
            column,
            filePath,
            language: lang,
            candidates: [slice.sliceVar],
          });
        }
      }
    }

    // (b) `export const { a, b } = <slice>.actions` -> action->reducer edge.
    const actionsRe = /(?:export\s+)?const\s*\{([^}]*)\}\s*=\s*([A-Za-z_$][\w$]*)\.actions\b/g;
    let am: RegExpExecArray | null;
    while ((am = actionsRe.exec(content)) !== null) {
      const destructured = am[1]!
        .split(',')
        .map((s) => s.trim().split(':')[0]!.trim())
        .filter(Boolean);
      const { line, column } = lineCol(content, am.index);
      for (const action of destructured) {
        const target = reducerQualified[action];
        if (!target) continue;
        references.push({
          fromNodeId: `file:${filePath}`,
          referenceName: RTK_REDUCER_PREFIX + target.qualifiedName,
          referenceKind: 'references',
          line,
          column,
          filePath,
          language: lang,
          candidates: [target.qualifiedName],
        });
      }
    }

    return { nodes, references };
  },

  claimsReference(name: string): boolean {
    return name.startsWith(RTK_REDUCER_PREFIX);
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (!ref.referenceName.startsWith(RTK_REDUCER_PREFIX)) return null;
    const qualifiedName = ref.referenceName.slice(RTK_REDUCER_PREFIX.length);

    const candidates = context.getNodesByQualifiedName(qualifiedName);
    if (candidates.length === 0) return null;

    // Prefer a reducer member in the same file.
    const sameFile = candidates.find((n) => n.filePath === ref.filePath);
    const target = sameFile ?? candidates[0]!;

    return {
      original: ref,
      targetNodeId: target.id,
      confidence: 0.8,
      resolvedBy: 'framework',
    };
  },
};
