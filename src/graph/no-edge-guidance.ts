import type { Node } from '../types';

/**
 * What `callers` / `callees` answers when the symbol is indexed but has no edge
 * in that direction. A bare "No callers found" reads as a failure, so the agent
 * falls back to reading files — measured at 54% of all callers calls in one
 * local transcript corpus. An empty edge set is an answer: the definition site,
 * why an indexed symbol can have none, and the call that continues the
 * investigation.
 *
 * Lives outside `src/mcp/` so the CLI can share the wording: `src/bin/` keeps
 * SQLite and tree-sitter behind a lazy `loadCodeGraph()`, and this module has
 * no runtime import to pull in.
 */
export function buildNoEdgeGuidance(
  symbol: string,
  nodes: Node[],
  direction: 'callers' | 'callees',
  surface: 'mcp' | 'cli' = 'mcp',
): string {
  const sites = nodes
    .slice(0, 5)
    .map((n) => `- ${n.name} (${n.kind}) - ${n.filePath}:${n.startLine}`)
    .join('\n');
  const more = nodes.length > 5 ? `\n- …and ${nodes.length - 5} more definitions` : '';

  const why = direction === 'callers'
    ? 'Nothing in the index calls it. Usual reasons: it is an entry point (CLI, route ' +
      'handler, test-only helper, public API); it is reached dynamically — a callback, ' +
      'an event name, DI, a string dispatch table — and that channel has no synthesizer ' +
      'yet; or the caller was edited after the last sync.'
    : 'It calls nothing the index tracks. Usual reasons: the body only touches ' +
      'built-ins or third-party packages outside the indexed tree; the work happens ' +
      'through a callback or an event it hands off; or it is a declaration, a type or ' +
      'a constant rather than a body.';

  let next: string;
  if (surface === 'cli') {
    next = `Continue inside codegraph: codegraph context "${symbol}" for the surrounding work, ` +
      `or codegraph query "${symbol}" for every symbol that shares the name.`;
  } else if (direction === 'callers') {
    next = `Continue inside codegraph: codegraph_explore { query: "${symbol}" } for the ` +
      `surrounding source and its neighbours, or codegraph_impact { symbol: "${symbol}" } ` +
      'for what a change there would reach.';
  } else {
    next = `Continue inside codegraph: codegraph_explore { query: "${symbol}" } for the body ` +
      `as written, or codegraph_trace from "${symbol}" toward the symbol you expect it to reach.`;
  }

  return (
    `No ${direction} found for "${symbol}" — the symbol IS indexed ` +
    `(${nodes.length} definition${nodes.length === 1 ? '' : 's'}):\n${sites}${more}\n\n` +
    `${why}\n\n${next}`
  );
}
