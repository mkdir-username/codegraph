/**
 * End-to-end: the built CLI started on a Node.js it refuses relaunches itself
 * under a supported install instead of exiting. Uses a real old Node from the
 * local nvm, so it is skipped on machines that have none installed.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isNodeTooOld } from '../src/bin/node-version-check';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');
const PKG_VERSION: string = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
).version;

function findOldNode(): string | undefined {
  const versionsDir = path.join(process.env.NVM_DIR || path.join(os.homedir(), '.nvm'), 'versions', 'node');
  if (!fs.existsSync(versionsDir)) return undefined;
  return fs
    .readdirSync(versionsDir)
    .filter((dir) => isNodeTooOld(dir.replace(/^v/, '')))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((dir) => path.join(versionsDir, dir, 'bin', 'node'))
    .find((bin) => fs.existsSync(bin));
}

const oldNode = findOldNode();

function nodeVersionOf(bin: string): string {
  return spawnSync(bin, ['-p', 'process.versions.node'], { encoding: 'utf8' }).stdout.trim();
}

const newNode = ['/opt/homebrew/bin/node', '/usr/local/bin/node']
  .filter((bin) => fs.existsSync(bin))
  .find((bin) => Number(nodeVersionOf(bin).split('.')[0]) >= 25);

function envWithout(...names: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of names) delete env[name];
  return env;
}

describe('CLI on an unsupported Node.js', () => {
  it.skipIf(!oldNode)('relaunches under a supported install and runs the command', () => {
    const res = spawnSync(oldNode!, [BIN, '--version'], {
      encoding: 'utf8',
      env: envWithout('CODEGRAPH_ALLOW_UNSAFE_NODE', 'CODEGRAPH_NODE', 'CODEGRAPH_NODE_RELAUNCHED', 'CODEGRAPH_WASM_RELAUNCHED'),
    });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.trim()).toBe(PKG_VERSION);
    expect(res.stderr).toContain('relaunching under');
  });

  it.skipIf(!oldNode)('keeps the block banner when no supported Node.js is installed', () => {
    const emptyNvm = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-empty-nvm-'));
    try {
      const res = spawnSync(oldNode!, [BIN, '--version'], {
        encoding: 'utf8',
        env: {
          ...envWithout('CODEGRAPH_ALLOW_UNSAFE_NODE', 'CODEGRAPH_NODE', 'CODEGRAPH_NODE_RELAUNCHED', 'CODEGRAPH_WASM_RELAUNCHED'),
          NVM_DIR: emptyNvm,
        },
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Unsupported Node.js version');
    } finally {
      fs.rmSync(emptyNvm, { recursive: true, force: true });
    }
  });

  it.skipIf(!oldNode)('does not relaunch when CODEGRAPH_ALLOW_UNSAFE_NODE is set', () => {
    const res = spawnSync(oldNode!, [BIN, '--version'], {
      encoding: 'utf8',
      env: {
        ...envWithout('CODEGRAPH_NODE', 'CODEGRAPH_NODE_RELAUNCHED', 'CODEGRAPH_WASM_RELAUNCHED'),
        CODEGRAPH_ALLOW_UNSAFE_NODE: '1',
      },
    });
    expect(res.stderr).not.toContain('relaunching under');
    expect(res.stderr).toContain('Unsupported Node.js version');
  });

  it.skipIf(!newNode)('relaunches from the Node 25+ block too', () => {
    const res = spawnSync(newNode!, [BIN, '--version'], {
      encoding: 'utf8',
      env: envWithout('CODEGRAPH_ALLOW_UNSAFE_NODE', 'CODEGRAPH_NODE', 'CODEGRAPH_NODE_RELAUNCHED', 'CODEGRAPH_WASM_RELAUNCHED'),
    });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.trim()).toBe(PKG_VERSION);
    expect(res.stderr).toContain('relaunching under');
  });
});

describe('CLI on a supported Node.js', () => {
  it('runs in place without relaunching', () => {
    const res = spawnSync(process.execPath, [BIN, '--version'], {
      encoding: 'utf8',
      env: envWithout('CODEGRAPH_ALLOW_UNSAFE_NODE', 'CODEGRAPH_NODE', 'CODEGRAPH_NODE_RELAUNCHED', 'CODEGRAPH_WASM_RELAUNCHED'),
    });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.trim()).toBe(PKG_VERSION);
    expect(res.stderr).not.toContain('relaunching under');
  });
});
