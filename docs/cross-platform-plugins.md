# Cross-Platform Plugin Support

> Research note: can `@debugtalk/opencode-dap` be used as a universal plugin across Claude Code, OpenAI Codex, and other AI coding agents?

## Short Answer

**No — the current package is even less portable than `opencode-hashline`.**

Like hashline, it is built for OpenCode's in-process plugin runtime. On top of that, the implementation is **Bun-only**: it relies on `Bun.spawn`, `Bun.Socket`, `Bun.Glob`, `Bun.which`, and other Bun APIs. Before it can run in Claude Code or Codex, the core must first be decoupled from Bun.

The good news is that `opencode-dap` adds a **new** tool (`debug`) rather than overriding an existing one, so mapping it to an MCP tool is conceptually more natural than hashline's `edit` override.

---

## Why It Does Not Work Out of the Box

| Capability | How OpenCode Does It | Claude Code / Codex |
|---|---|---|
| Plugin shape | npm package exporting a TypeScript factory function | Directory package with `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json` |
| Register `debug` tool | `tool: { debug: debugTool }` | New tools must be exposed via MCP servers |
| Session cleanup on idle | `event` hook listening for `session.idle` / `session.deleted` | Claude Code hooks are external JSON-driven actions; Codex plugin hooks are documented but not currently loaded by the runtime (see openai/codex#17331) |
| Spawn debug adapters | `Bun.spawn` | Node.js `child_process.spawn` or a runtime abstraction layer |
| Resolve binaries | `Bun.which` | `which` package or `cross-spawn` equivalent |
| Project root markers | `Bun.Glob` | `fast-glob`, `glob`, or manual traversal |
| Socket attach (dlv, etc.) | `Bun.listen` / `Bun.connect` | `node:net` |
| Timers | `Bun.sleep` | `setTimeout` wrapper |
| Distribution | Ships raw `.ts` source | Requires a built executable or bundled MCP server |

`AGENTS.md` explicitly states:

> **Bun-only**: Uses `Bun.spawn`, `Bun.Glob`, `Bun.which`, `Bun.Subprocess`, `Buffer`. Do not import node polyfills unless adding Node.js compatibility.

So cross-platform support is not just a packaging problem — it is a **runtime-portability problem**.

---

## Recommended Path to Cross-Platform Support

Because the core is Bun-specific, the work is larger than for `opencode-hashline`. The recommended path is:

### 1. Abstract the runtime

Introduce a small runtime interface that hides Bun vs. Node differences:

```ts
interface RuntimeAdapter {
  spawn(command: string[], opts: SpawnOptions): Subprocess;
  which(command: string): string | null;
  glob(pattern: string): AsyncIterable<string>;
  listen(options: ListenOptions): Promise<Server>;
  connect(options: ConnectOptions): Promise<Socket>;
  sleep(ms: number): Promise<void>;
}
```

Implement it twice:

- `BunRuntimeAdapter` — keeps the current behavior for OpenCode users.
- `NodeRuntimeAdapter` — uses `node:child_process`, `node:net`, `fast-glob`, `which`, etc.

### 2. Build an MCP server wrapper

Create a new entry point (for example `mcp-server/src/server.ts`) that exposes a `dap_debug` tool:

```json
{
  "name": "dap_debug",
  "description": "Launch, control, and inspect a debug session via the Debug Adapter Protocol.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["launch", "attach", "set_breakpoint", "continue", ...] },
      "program": { "type": "string" },
      "file": { "type": "string" },
      "line": { "type": "number" },
      "expression": { "type": "string" },
      "timeout": { "type": "number" }
    },
    "required": ["action"]
  }
}
```

The MCP server uses the `NodeRuntimeAdapter` and imports `DapSessionManager` from the core.

### 3. Add a build step

Claude Code and Codex plugins expect executable scripts, not raw TypeScript. Add a build that outputs:

```text
dist/
├── mcp-server.js          # bundled MCP server
└── ...
```

Then the agent plugin manifests reference the built server:

```json
{
  "mcpServers": {
    "dap": {
      "command": "node",
      "args": ["./dist/mcp-server.js"]
    }
  }
}
```

### 4. Provide Claude Code and Codex plugin directories

```text
claude-plugin/
├── .claude-plugin/plugin.json
├── skills/debug/SKILL.md      # when to launch, set breakpoints, evaluate
└── .mcp.json                  # points to dist/mcp-server.js

codex-plugin/
├── .codex-plugin/plugin.json
├── skills/debug/SKILL.md
└── .mcp.json
```

The skill should teach the agent:

- When to start a debug session (`launch`) vs. attach (`attach`).
- How to set breakpoints and continue execution.
- That it should call `dap_debug` instead of any built-in debug command.

### 5. Keep OpenCode native plugin as the first-class path

OpenCode users should keep the current experience:

```json
{ "plugin": ["@debugtalk/opencode-dap"] }
```

The native plugin can continue using `BunRuntimeAdapter` and the OpenCode `event` hook for session cleanup.

---

## Feature Parity Expectations

| Feature | OpenCode native plugin | Claude Code / Codex via MCP |
|---|---|---|
| `debug` tool available naturally | ✅ | ✅ via MCP |
| Session idle/deleted cleanup | ✅ automatic | ⚠️ needs explicit cleanup or server lifetime management |
| Bun-only optimizations | ✅ | ❌ uses Node polyfills |
| Auto adapter selection | ✅ | ✅ if core logic is shared |
| Attach via Unix/TCP socket | ✅ | ✅ after `node:net` migration |

---

## What Not to Do

- **Do not try to ship raw `.ts` files to Claude Code or Codex.** They need executable servers or scripts.
- **Do not sprinkle Node polyfills into `src/client.ts` or `src/session.ts` directly.** Abstract the runtime first, or the code will become hard to maintain.
- **Do not rely on plugin-defined lifecycle hooks in Codex** until the known issue with plugin hooks not loading is resolved.

---

## Summary

- **Current package:** OpenCode-only and Bun-only.
- **Conceptual fit for cross-platform:** better than hashline because it adds a new tool (`debug`) rather than overriding a built-in one.
- **Required work:** runtime abstraction to remove Bun lock-in, build/bundle step, MCP server wrapper, agent-specific plugin directories.
- **Best strategy:** keep the OpenCode native plugin unchanged, then build a Node-compatible MCP layer on top of a shared, runtime-agnostic core.
