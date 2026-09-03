/**
 * Node.js version compatibility check.
 *
 * Node 25.x has a V8 turboshaft WASM JIT Zone allocator bug that
 * reliably crashes CodeGraph with `Fatal process out of memory: Zone`
 * during tree-sitter grammar compilation. This module owns the
 * user-facing banner shown before exit. Kept side-effect-free so it's
 * safe to import from tests without triggering CLI bootstrap.
 */

/**
 * Build the bordered banner shown when CodeGraph detects an
 * unsupported Node.js major version (currently 25+). Pinned via unit
 * test so the recovery commands and override instructions can't be
 * silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNode25BlockBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[CodeGraph] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    'Node.js 25.x has a V8 WASM JIT (turboshaft) Zone allocator bug that',
    'crashes with `Fatal process out of memory: Zone` when CodeGraph',
    'compiles tree-sitter grammars. CodeGraph WILL crash on this Node',
    'version mid-indexing. See https://github.com/colbymchenry/codegraph/issues/81',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - you will likely OOM):',
    '  CODEGRAPH_ALLOW_UNSAFE_NODE=1 codegraph ...',
    sep,
  ].join('\n');
}

/**
 * Lowest supported Node.js version. Matches the `engines` floor in package.json.
 *
 * The minor half is load-bearing, not decoration: `node:sqlite` only gained FTS5
 * in 22.16, and CodeGraph's whole search layer is FTS5. On 22.14 — a version the
 * old major-only floor waved through — the index opens, then every query dies
 * with `no such module: fts5`, which names neither the cause nor the fix.
 *
 * `engines` alone only *warns* on install (unless the user set `engine-strict`),
 * so the CLI bootstrap hard-blocks on {@link isNodeTooOld}, and the database
 * adapter guards the paths that never touch the CLI.
 */
export const MIN_NODE_MAJOR = 22;
export const MIN_NODE_MINOR = 16;

/**
 * True when the given `process.versions.node` string is below the supported
 * floor. An unparseable version returns false: a runtime we cannot read is not
 * evidence of an old runtime, and blocking on a guess would lock out a valid
 * environment for a formatting quirk.
 */
export function isNodeTooOld(nodeVersion: string): boolean {
  // Digit test rather than Number(): `Number('')` is 0, which would read an
  // empty version as "ancient" and block a runtime we simply failed to parse.
  const [rawMajor, rawMinor] = nodeVersion.split('.');
  if (!rawMajor || !/^\d+$/.test(rawMajor)) return false;
  const major = Number(rawMajor);
  if (major !== MIN_NODE_MAJOR) return major < MIN_NODE_MAJOR;
  if (!rawMinor || !/^\d+$/.test(rawMinor)) return false;
  return Number(rawMinor) < MIN_NODE_MINOR;
}

/**
 * Build the bordered banner shown when CodeGraph detects a Node.js major below
 * {@link MIN_NODE_MAJOR}. Pinned via unit test so the recovery commands and the
 * override env var can't be silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNodeTooOldBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[CodeGraph] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    `CodeGraph requires Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer. Below that,`,
    'the built-in node:sqlite ships without FTS5 — the module CodeGraph builds its',
    'entire search index on. The index opens, then every query fails with',
    '`no such module: fts5`, which points at neither the cause nor the fix.',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - unsupported):',
    '  CODEGRAPH_ALLOW_UNSAFE_NODE=1 codegraph ...',
    sep,
  ].join('\n');
}
