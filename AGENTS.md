# opencode-dap

## Commands

```bash
npm run check && npm test     # pre-publish verification (type-check + tests)
npm run check                 # tsc --noEmit (type check only)
npm test                      # bun test tests/ (run all tests)
```

Run `npm run check && npm test` before committing. No build step — the package ships `.ts` source directly.

## Architecture

Single package, no monorepo. Entry: `src/index.ts`.

```
src/
├── plugin.ts       ← OpenCode plugin (debug tool + lifecycle), distribution entry
├── session.ts      ← DapSessionManager (session lifecycle, breakpoint serialization)
├── client.ts       ← DapClient (DAP wire protocol: Content-Length framing)
├── config.ts       ← adapter resolution (auto-select by file extension/root markers)
├── types.ts        ← DAP protocol types
├── defaults.json   ← bundled adapter catalog (14 adapters)
├── non-interactive-env.ts ← CI-safe env vars injected into debugger subprocesses
└── index.ts        ← re-exports everything
```

## Key constraints

- **Bun-only**: Uses `Bun.spawn`, `Bun.Glob`, `Bun.which`, `Bun.Subprocess`, `Buffer`. Do not import node polyfills unless adding Node.js compatibility.
- **No build**: Exports point to `.ts` source. Consumers must use Bun or `tsx`.
- **`check:syntax` is hardcoded**: add new source files to the script in `package.json`.
- **Dependencies are dev-only**: `typescript`, `@types/node`, `bun-types`, `@opencode-ai/plugin`. Runtime uses only Bun built-ins.
- **Distribution**: published to npm, consumed as OpenCode plugin via `"plugin": ["@debugtalk/opencode-dap"]` in `opencode.json`. Users install with `opencode plugin @debugtalk/opencode-dap` and upgrade with `--force`. See `docs/publish.md` for release steps.

## Testing

Verify before publishing: `npm run check && npm test`. See [Bun test docs](https://bun.sh/docs/cli/test) for test authoring.
