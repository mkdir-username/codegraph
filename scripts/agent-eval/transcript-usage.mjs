#!/usr/bin/env node
// What codegraph actually does in an agent's hands, read from Claude Code's own
// transcripts (~/.claude/projects/<escaped-cwd>/*.jsonl).
//
// Reports, per codegraph tool: how often it was called, how often the answer was
// empty or an error, and — the number that matters — what the agent reached for
// NEXT. A Read right after a codegraph call is the tool failing at its job.
//
// Count `tool_use` blocks inside message.content. Do NOT grep the files for
// "mcp__codegraph__": tool SCHEMAS carry that string too, which overcounts by
// ~300x (measured: 36k grep hits vs 120 real calls on one machine).
//
// usage: node scripts/agent-eval/transcript-usage.mjs [--days N] [--project <substr>] [--json]
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const days = Number(flag('--days', '0'));
const projectFilter = flag('--project', '');
const asJson = argv.includes('--json');

const root = join(homedir(), '.claude', 'projects');
if (!existsSync(root)) {
  console.error(`no transcripts at ${root}`);
  process.exit(1);
}

const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
const EMPTY = /^\s*(?:Error: )?(?:No (?:results|callers|callees|matches|symbols|nodes|path|files)\b|Symbol .* not found|CodeGraph not initialized|No CodeGraph project is loaded)/i;
const short = (name) => name.replace(/^mcp__codegraph__codegraph_/, '');

const files = [];
// Subagent transcripts live in nested directories (…/<project>/subagents/…), and
// their calls count too — walk the whole tree, not just the project's top level.
function collect(dir, project) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { collect(full, project); continue; }
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    if (cutoff && statSync(full).mtimeMs < cutoff) continue;
    files.push({ file: full, project });
  }
}
for (const dir of readdirSync(root)) {
  if (projectFilter && !dir.includes(projectFilter)) continue;
  collect(join(root, dir), dir);
}

const calls = new Map();       // tool -> count
const bad = new Map();         // tool -> empty/error count
const noProject = { n: 0 };
const nextTool = new Map();    // what followed a codegraph call
const perProject = new Map();
let allToolUses = 0;

for (const { file, project } of files) {
  let lines;
  try { lines = readFileSync(file, 'utf8').split('\n'); } catch { continue; }

  const pending = new Map();   // tool_use_id -> short tool name
  const order = [];            // tool names in call order, this transcript

  for (const line of lines) {
    if (!line.includes('tool_use') && !line.includes('tool_result')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const content = event?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type === 'tool_use') {
        allToolUses++;
        order.push(block.name ?? '?');
        if (!String(block.name).startsWith('mcp__codegraph__')) continue;
        const tool = short(block.name);
        pending.set(block.id, tool);
        calls.set(tool, (calls.get(tool) ?? 0) + 1);
        perProject.set(project, (perProject.get(project) ?? 0) + 1);
      } else if (block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
        const tool = pending.get(block.tool_use_id);
        let body = block.content;
        if (Array.isArray(body)) body = body.map((c) => c?.text ?? '').join(' ');
        body = typeof body === 'string' ? body : String(body ?? '');
        const isProjectError = /No CodeGraph project is loaded|not initialized/.test(body);
        if (block.is_error || EMPTY.test(body) || isProjectError) {
          bad.set(tool, (bad.get(tool) ?? 0) + 1);
          if (isProjectError) noProject.n++;
        }
      }
    }
  }

  for (let i = 0; i < order.length - 1; i++) {
    if (!order[i].startsWith('mcp__codegraph__')) continue;
    const next = order[i + 1];
    const key = next.startsWith('mcp__codegraph__') ? 'codegraph_*' : next;
    nextTool.set(key, (nextTool.get(key) ?? 0) + 1);
  }
}

const totalCalls = [...calls.values()].reduce((a, b) => a + b, 0);
const totalBad = [...bad.values()].reduce((a, b) => a + b, 0);
const followTotal = [...nextTool.values()].reduce((a, b) => a + b, 0);
const readAfter = (nextTool.get('Read') ?? 0) + (nextTool.get('Grep') ?? 0);

if (asJson) {
  console.log(JSON.stringify({
    transcripts: files.length,
    allToolUses,
    totalCalls,
    totalBad,
    projectErrors: noProject.n,
    perTool: Object.fromEntries([...calls].map(([k, v]) => [k, { calls: v, bad: bad.get(k) ?? 0 }])),
    nextTool: Object.fromEntries(nextTool),
  }, null, 2));
  process.exit(0);
}

const pct = (n, of) => (of === 0 ? '  n/a' : `${((100 * n) / of).toFixed(1).padStart(5)}%`);

console.log(`transcripts scanned: ${files.length}${days ? ` (last ${days} days)` : ''}`);
console.log(`codegraph calls: ${totalCalls} of ${allToolUses} tool uses — ${pct(totalCalls, allToolUses)}`);
console.log(`failed or empty: ${totalBad} (${noProject.n} of them "no project / not initialized")\n`);

console.log('tool          calls    bad   fail%');
for (const [tool, n] of [...calls].sort((a, b) => b[1] - a[1])) {
  const b = bad.get(tool) ?? 0;
  console.log(`${tool.padEnd(12)} ${String(n).padStart(6)} ${String(b).padStart(6)} ${pct(b, n)}`);
}

console.log('\nwhat the agent called NEXT after a codegraph call');
for (const [tool, n] of [...nextTool].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(n).padStart(6)} ${pct(n, followTotal)}  ${tool}`);
}
console.log(`\nRead/Grep right after codegraph: ${readAfter} — ${pct(readAfter, followTotal)} of follow-ups.`);
console.log('That share is the number to drive down: it means the answer was not enough.');

if (perProject.size > 0) {
  console.log('\ncalls by project');
  for (const [project, n] of [...perProject].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(n).padStart(6)}  ${project}`);
  }
}
