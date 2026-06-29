# DAP Sync Guide

opencode-dap's DAP protocol core is sourced from oh-my-pi's `pi-coding-agent`.
This document records the sync baseline, per-file mappings, and the procedure
for pulling upstream changes.

## Baseline

| What | Commit |
|------|--------|
| **oh-my-pi baseline** | `54d4a1f3a` — *fix: LSP client lifecycle and DAP session robustness* (2026-06-10) |
| **Initial port** | opencode-dap `eb760f7` — *feat: initial DAP client for opencode — ported from oh-my-pi* (2026-06-12) |
| **Last sync** | opencode-dap `76232a6` — *fix: sync oh-my-pi DAP — launch args, AbortSignal timeout, tests* |

## Per-file mapping

| opencode-dap | oh-my-pi | Port style | Notes |
|---|---|---|---|
| `src/client.ts` | `dap/client.ts` | **Adapt** | Replaced `ptree.spawn` with `Bun.spawn` + `spawnProc()`; replaced `MessageFramer` with inline chunk parsing; replaced `ToolAbortError` with `DapAbortError`; replaced `logger` with `logError`/`logWarn` (JSON to console.error) |
| `src/session.ts` | `dap/session.ts` | **Adapt** | Replaced `@oh-my-pi/pi-utils` (`logger`, `ptree`, `untilAborted`) with inline; `clientID` changed to `"opencode"`; `clientName` to `"OpenCode"`; added `DapSessionManager.dispose()`; added `logError`/`logWarn`; no global singleton export |
| `src/config.ts` | `dap/config.ts` | **Adapt** | Removed multi-source config loading (`loadAdapterConfigs`, `getConfigSources`, YAML/JSON parsing, plugin dirs); inlined `hasRootMarkers`, `resolveCommand`, `isRecord`; uses `DEFAULT_ADAPTERS` only; added `normalizeCommandForCwd` (ported from `2afa7d49c`) |
| `src/types.ts` | `dap/types.ts` | **Near copy** | Only changed `DapClientState.proc` from `ptree.ChildProcess` to `Bun.Subprocess`; removed `ptree` import |
| `src/defaults.json` | `dap/defaults.json` | **Copy** | Byte-identical |
| `src/non-interactive-env.ts` | `exec/non-interactive-env.ts` | **Adapt** | Kept the static `NON_INTERACTIVE_ENV` constant; removed `buildNonInteractiveEnv()` and all Windows locale/UTF-8 runtime logic |
| `src/plugin.ts` | `tools/debug.ts` | **Rewrite** | Built from scratch for `@opencode-ai/plugin` framework (oh-my-pi uses `AgentTool` class pattern); has 30 actions vs 28 (added `set_function_breakpoint`/`remove_function_breakpoint`) |
| `prompts/tools/debug.md` | `prompts/tools/debug.md` | **Adapt** | Same structure; added timeout info and `set_function_breakpoint` actions |

## Sync procedure

### 1. Diff oh-my-pi DAP against baseline

```bash
OMPI=/path/to/oh-my-pi
OMPI_BASELINE=54d4a1f3a

for f in client.ts session.ts config.ts types.ts defaults.json; do
  echo "=== dap/$f ==="
  git -C "$OMPI" diff "$OMPI_BASELINE"..HEAD -- "packages/coding-agent/src/dap/$f"
done
```

### 2. Diff non-interactive-env

```bash
git -C "$OMPI" diff "$OMPI_BASELINE"..HEAD -- "packages/coding-agent/src/exec/non-interactive-env.ts"
```

### 3. Diff debug tool (model-facing changes)

```bash
git -C "$OMPI" diff "$OMPI_BASELINE"..HEAD -- \
  "packages/coding-agent/src/tools/debug.ts" \
  "packages/coding-agent/src/prompts/tools/debug.md"
```

### 4. Diff tests

```bash
git -C "$OMPI" diff "$OMPI_BASELINE"..HEAD -- \
  "packages/coding-agent/test/debug/"
```

### 5. Apply relevant changes

For each diff chunk:

| File type | Action |
|---|---|
| `types.ts` / `defaults.json` | Apply directly (these are near-copies) |
| `client.ts` / `session.ts` | Read diff, apply only the logic changes (not import/logger/spawn replacements) using the normalized diff approach below |
| `config.ts` | Apply new functions only (e.g. `normalizeCommandForCwd`); skip config-loading infrastructure |
| `debug.md` | Apply directly |
| `debug.ts` | Read for action/schema changes; manually port to `plugin.ts` |

### Normalized diff (removes overhead of port-specific noise)

```bash
# Strip imports and logger/spawn calls to focus on logic differences
git -C "$OMPI" diff "$OMPI_BASELINE"..HEAD -- packages/coding-agent/src/dap/session.ts \
  | sed 's/timers\.setTimeout/Bun.sleep/g; s/timers\.setInterval/setInterval/g; s/ptree\.spawn/Bun.spawn/g; s/logger\.error/logError/g; s/logger\.debug/logWarn/g' \
  | sed 's/@oh-my-pi\/pi-utils/LOCAL/g; s/node:timers\/promises/LOCAL/g; s/import.*from "LOCAL";//g' \
  | grep -v '^[-+]import' | grep -v '^[-+]\s*//' | grep -v '^\+\+\+ ' | grep -v '^--- '
```

### 6. Verify

```bash
npm run check
bun run check:syntax
bun test
```

### 7. Update this file

After each sync, update the **Last sync** row above.

## Known omissions (by design)

| Feature | Reason |
|---|---|
| Multi-source config loading (`.dap.json`, `.dap.yaml`, plugin dirs) | opencode-dap only uses bundled `defaults.json`; OpenCode users configure adapters via the OpenCode plugin mechanism |
| `ToolError` class | Replaced with plain `Error` — `@opencode-ai/plugin` doesn't have a tool error abstraction |
| `DebugTool` TUI renderer (`debugToolRenderer`) | OpenCode plugins render via the platform's native component tree |
| `debug.enabled` gating | OpenCode plugins are always enabled once registered |
| Windows locale/UTF-8 runtime logic in `non-interactive-env.ts` | opencode-dap ships the static env table; runtime platform detection is the consumer's responsibility |
| `MessageFramer` shared class | Replaced with standalone chunk-based parsing; the protocol is identical |
| `@oh-my-pi/pi-utils` dependency (`ptree`, `logger`, `untilAborted`) | All inlined or replaced with Bun-native equivalents |
