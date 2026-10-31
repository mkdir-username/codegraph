/**
 * Finding a supported Node.js to relaunch under. A project that pins an old
 * Node via `.nvmrc` puts it first on PATH, so `#!/usr/bin/env node` starts the
 * CLI on a runtime it refuses. These tests pin which installed runtime wins.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findSupportedNode, isNodeSupported } from '../src/bin/supported-node';

let nvmDir: string;

function install(...versions: string[]): void {
  for (const version of versions) {
    const bin = path.join(nvmDir, 'versions', 'node', `v${version}`, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'node'), '', { mode: 0o755 });
  }
}

function setAlias(alias: string): void {
  fs.mkdirSync(path.join(nvmDir, 'alias'), { recursive: true });
  fs.writeFileSync(path.join(nvmDir, 'alias', 'default'), `${alias}\n`);
}

const nodeOf = (version: string) => path.join(nvmDir, 'versions', 'node', `v${version}`, 'bin', 'node');

beforeEach(() => {
  nvmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-nvm-'));
});

afterEach(() => {
  fs.rmSync(nvmDir, { recursive: true, force: true });
});

describe('isNodeSupported', () => {
  it('accepts the FTS5 floor and anything below the Node 25 block', () => {
    expect(isNodeSupported('22.16.0')).toBe(true);
    expect(isNodeSupported('24.14.1')).toBe(true);
  });

  it('rejects versions below the floor, Node 25+, and unparseable names', () => {
    expect(isNodeSupported('22.15.9')).toBe(false);
    expect(isNodeSupported('22.14.0')).toBe(false);
    expect(isNodeSupported('25.0.0')).toBe(false);
    expect(isNodeSupported('abc')).toBe(false);
  });

  it('rejects names that are not a bare major.minor.patch', () => {
    expect(isNodeSupported('22.16')).toBe(false);
    expect(isNodeSupported('v22.16.0')).toBe(false);
    expect(isNodeSupported('22.16.0-rc.1')).toBe(false);
    expect(isNodeSupported('x22.16.0')).toBe(false);
  });
});

describe('findSupportedNode', () => {
  it('prefers the nvm default alias when it is supported', () => {
    install('22.14.0', '22.22.3', '24.14.1');
    setAlias('22.22.3');
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBe(nodeOf('22.22.3'));
  });

  it('falls back to the newest supported install when the alias is too old, skipping Node 25', () => {
    install('22.14.0', '22.22.3', '24.14.1', '25.1.0');
    setAlias('22.14.0');
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBe(nodeOf('24.14.1'));
  });

  it('resolves a prefix alias to the newest matching supported install', () => {
    install('22.16.0', '22.22.3', '24.14.1');
    setAlias('22');
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBe(nodeOf('22.22.3'));
  });

  it('sorts versions numerically, not as strings', () => {
    install('22.9.0', '22.22.3', '22.100.0');
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBe(nodeOf('22.100.0'));
  });

  it('orders installs that differ only in the patch or only in the major', () => {
    install('22.22.3', '22.22.0');
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBe(nodeOf('22.22.3'));
    fs.rmSync(path.join(nvmDir, 'versions'), { recursive: true, force: true });
    install('22.16.0', '24.16.0');
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBe(nodeOf('24.16.0'));
  });

  it('reads an alias written with the v prefix', () => {
    install('22.22.3', '24.14.1');
    setAlias('v22.22.3');
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBe(nodeOf('22.22.3'));
  });

  it('honours CODEGRAPH_NODE when the file exists, even without nvm', () => {
    const explicit = path.join(nvmDir, 'my-node');
    fs.writeFileSync(explicit, '', { mode: 0o755 });
    expect(findSupportedNode({ CODEGRAPH_NODE: explicit, NVM_DIR: path.join(nvmDir, 'none') }, '/nowhere')).toBe(explicit);
  });

  it('ignores CODEGRAPH_NODE pointing at a missing file', () => {
    install('22.22.3');
    expect(
      findSupportedNode({ CODEGRAPH_NODE: path.join(nvmDir, 'gone'), NVM_DIR: nvmDir }, '/nowhere')
    ).toBe(nodeOf('22.22.3'));
  });

  it('returns null when nothing installed is supported', () => {
    install('22.14.0', '25.1.0');
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBeNull();
  });

  it('returns null when nvm has no versions directory', () => {
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBeNull();
  });

  it('skips a version directory without bin/node', () => {
    install('22.22.0');
    fs.mkdirSync(path.join(nvmDir, 'versions', 'node', 'v24.14.1'), { recursive: true });
    expect(findSupportedNode({ NVM_DIR: nvmDir }, '/nowhere')).toBe(nodeOf('22.22.0'));
  });

  it('defaults NVM_DIR to ~/.nvm under the given home', () => {
    const home = nvmDir;
    nvmDir = path.join(home, '.nvm');
    install('22.22.3');
    expect(findSupportedNode({}, home)).toBe(nodeOf('22.22.3'));
    nvmDir = home;
  });
});
