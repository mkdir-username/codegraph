/**
 * Relaunch under a supported Node.js.
 *
 * The CLI ships with `#!/usr/bin/env node`, so it runs on whatever Node is first
 * on PATH. A project that pins an older Node through `.nvmrc` (nvm switches PATH
 * on `cd`) starts CodeGraph on a runtime it refuses — below the FTS5 floor or in
 * the Node 25 block — and every hook or script calling `codegraph sync` there
 * fails, even though a supported Node is installed next to it. Instead of
 * exiting, the CLI finds that install and re-execs itself under it, the same way
 * it already re-execs for the WASM runtime flags (../extraction/wasm-runtime-flags).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isNodeTooOld } from './node-version-check';
import { buildRelaunchArgv, HOST_PPID_ENV, RELAUNCH_GUARD_ENV } from '../extraction/wasm-runtime-flags';

/** Set on the relaunched child so a misread version can never loop the re-exec. */
const NODE_RELAUNCH_GUARD_ENV = 'CODEGRAPH_NODE_RELAUNCHED';

/** True for a version CodeGraph runs on: at or above the FTS5 floor and below the Node 25 block. */
export function isNodeSupported(version: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  return !isNodeTooOld(version) && Number(version.split('.')[0]) < 25;
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pb[i] ?? 0) - (pa[i] ?? 0);
  }
  return 0;
}

/**
 * Installed Node.js binary CodeGraph supports, or null. Order: CODEGRAPH_NODE,
 * the nvm default alias (exact or prefix), the newest supported nvm install.
 */
export function findSupportedNode(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string | null {
  if (env.CODEGRAPH_NODE && fs.existsSync(env.CODEGRAPH_NODE)) return env.CODEGRAPH_NODE;

  const nvmDir = env.NVM_DIR || path.join(home, '.nvm');
  const versionsDir = path.join(nvmDir, 'versions', 'node');
  if (!fs.existsSync(versionsDir)) return null;

  const binOf = (version: string) => path.join(versionsDir, `v${version}`, 'bin', 'node');
  const usable = fs
    .readdirSync(versionsDir)
    .map((dir) => dir.replace(/^v/, ''))
    .filter((version) => isNodeSupported(version) && fs.existsSync(binOf(version)))
    .sort(compareVersionsDesc);
  if (usable.length === 0) return null;

  const aliasFile = path.join(nvmDir, 'alias', 'default');
  const alias = fs.existsSync(aliasFile)
    ? fs.readFileSync(aliasFile, 'utf8').trim().replace(/^v/, '')
    : '';
  const preferred = alias
    ? usable.find((version) => version === alias || version.startsWith(`${alias}.`))
    : undefined;
  return binOf(preferred ?? usable[0]!);
}

/**
 * Re-exec the CLI under a supported Node.js and exit with the child's status.
 * Returns when no supported install exists, when already relaunched, or when the
 * spawn fails — the caller then shows the block banner as before.
 */
export function relaunchUnderSupportedNodeIfFound(scriptPath: string, nodeVersion: string): void {
  if (process.env[NODE_RELAUNCH_GUARD_ENV]) return;
  const target = findSupportedNode();
  if (!target) return;

  process.stderr.write(`[CodeGraph] Node.js ${nodeVersion} is unsupported; relaunching under ${target}\n`);
  // The argv already carries the WASM runtime flags, so the child skips its own relaunch.
  const result = spawnSync(target, buildRelaunchArgv(scriptPath, process.argv.slice(2)), {
    stdio: 'inherit',
    env: {
      ...process.env,
      [NODE_RELAUNCH_GUARD_ENV]: '1',
      [RELAUNCH_GUARD_ENV]: '1',
      [HOST_PPID_ENV]: String(process.ppid),
    },
  });
  if (result.error) return;
  process.exit(result.status ?? 1);
}
