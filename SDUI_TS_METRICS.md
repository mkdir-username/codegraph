# SDUI_TS Validation Metrics — Phase 1

## Before (v0.9.5 unpatched)
- Nodes: 68,760
- Edges: 88,735
- Call edges: 7,664
- Non-exported constants: 50,786
- `createRef` callers: 0
- Query quality (10 symbols): 3/10

## After (Phase 1 patches)
- Nodes: 68,807 (+47 from method-shorthand extraction)
- Edges: 90,094 (+1,359)
- Call edges: 8,758 (+1,094, +14%)
- Non-exported constants: 50,786 (unchanged, generated schema — Phase 2 scope)
- `createRef` callers: **14** (was 0)
- Query quality (5 tested): 5/5

## Patches applied
1. `visitValueForCalls` — walk value expressions in variable initializers for call/instantiation edges
2. Method-shorthand extraction from exported object literals (`{ method() {} }` syntax)

## Environment
- Node: v22.22.3
- codegraph: fork of 0.9.5
- SDUI_TS: 3,046 files indexed
