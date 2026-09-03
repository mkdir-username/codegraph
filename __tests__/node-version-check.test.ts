/**
 * Pin the Node-25 block banner content. The banner replaced a soft
 * `console.warn` because the warning was scrolling off-screen before
 * the OOM crash 30 seconds later, generating duplicate bug reports
 * (#54, #81, #140). The recipe and override env var below are
 * load-bearing — if any of them get edited away, this test catches it.
 */

import { describe, it, expect } from 'vitest';
import {
  buildNode25BlockBanner,
  buildNodeTooOldBanner,
  isNodeTooOld,
  MIN_NODE_MAJOR,
  MIN_NODE_MINOR,
} from '../src/bin/node-version-check';

describe('buildNode25BlockBanner', () => {
  it('embeds the reported Node version in the header', () => {
    expect(buildNode25BlockBanner('25.9.0')).toContain(
      'Unsupported Node.js version: 25.9.0'
    );
  });

  it('names the V8 turboshaft WASM root cause and the OOM symptom', () => {
    const banner = buildNode25BlockBanner('25.7.0');
    expect(banner).toContain('V8 WASM JIT');
    expect(banner).toContain('turboshaft');
    expect(banner).toContain('Fatal process out of memory: Zone');
  });

  it('points users to Node 22 LTS via nvm and Homebrew', () => {
    const banner = buildNode25BlockBanner('25.7.0');
    expect(banner).toContain('Node.js 22 LTS');
    expect(banner).toContain('nvm install 22');
    expect(banner).toContain('brew install node@22');
  });

  it('documents the CODEGRAPH_ALLOW_UNSAFE_NODE override', () => {
    const banner = buildNode25BlockBanner('25.7.0');
    expect(banner).toContain('CODEGRAPH_ALLOW_UNSAFE_NODE=1');
  });

  it('links to issue #81 for the root-cause writeup', () => {
    expect(buildNode25BlockBanner('25.7.0')).toContain(
      'github.com/colbymchenry/codegraph/issues/81'
    );
  });
});

describe('buildNodeTooOldBanner', () => {
  it('embeds the reported Node version in the header', () => {
    expect(buildNodeTooOldBanner('18.20.0')).toContain(
      'Unsupported Node.js version: 18.20.0'
    );
  });

  it('states the supported floor matching the pinned minimum', () => {
    expect(MIN_NODE_MAJOR).toBe(22);
    expect(MIN_NODE_MINOR).toBe(16);
    expect(buildNodeTooOldBanner('18.0.0')).toContain(
      `requires Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer`
    );
  });

  it('names FTS5 as the reason for the floor', () => {
    // The floor is not stylistic: below it `node:sqlite` ships without FTS5 and
    // every search query dies with a message that explains nothing.
    const banner = buildNodeTooOldBanner('22.14.0');
    expect(banner).toContain('FTS5');
    expect(banner).toContain('no such module: fts5');
  });

  it('points users to Node 22 LTS via nvm and Homebrew', () => {
    const banner = buildNodeTooOldBanner('16.0.0');
    expect(banner).toContain('Node.js 22 LTS');
    expect(banner).toContain('nvm install 22');
    expect(banner).toContain('brew install node@22');
  });

  it('documents the CODEGRAPH_ALLOW_UNSAFE_NODE override', () => {
    expect(buildNodeTooOldBanner('18.0.0')).toContain('CODEGRAPH_ALLOW_UNSAFE_NODE=1');
  });
});

describe('isNodeTooOld', () => {
  it('rejects a version inside the old major range', () => {
    expect(isNodeTooOld('20.11.0')).toBe(true);
    expect(isNodeTooOld('18.20.0')).toBe(true);
  });

  it('rejects a 22.x below the FTS5 minor — the version that used to slip through', () => {
    expect(isNodeTooOld('22.14.0')).toBe(true);
    expect(isNodeTooOld('22.0.0')).toBe(true);
  });

  it('accepts the exact floor and anything above it', () => {
    expect(isNodeTooOld('22.16.0')).toBe(false);
    expect(isNodeTooOld('22.22.3')).toBe(false);
    expect(isNodeTooOld('24.1.0')).toBe(false);
  });

  it('treats an unparseable version as supported rather than blocking on a guess', () => {
    expect(isNodeTooOld('')).toBe(false);
    expect(isNodeTooOld('not-a-version')).toBe(false);
  });
});
