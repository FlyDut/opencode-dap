# Changelog

## [Unreleased]

### Added
- Initial release of `@debugtalk/opencode-debug`, ported from oh-my-pi's DAP implementation
- Full DAP wire protocol client with stdio and socket transport
- Session manager with launch/attach lifecycle, breakpoint management, step/continue/pause, variable inspection, memory read/write, and disassembly
- Adapter resolution with auto-selection by file extension and project root markers
- Bundled adapter catalog with 14 debug adapters: gdb, lldb-dap, codelldb, debugpy, dlv, js-debug-adapter, netcoredbg, kotlin-debug-adapter, rdbg, php-debug-adapter, bash-debug-adapter, dart-debug-adapter, flutter-debug-adapter, elixir-ls-debugger
- OpenCode custom tool integration (`tools/debug.ts`) with 30 debug actions
- OpenCode lifecycle plugin for auto-cleanup on session idle
- Non-interactive environment injection for all spawned debugger processes
- Race-condition-safe event subscription (subscribe before command send)
- Serialized breakpoint mutations to prevent concurrent overwrites
- Friendly error messages: `debugpy` missing module detection, adapter-not-found hints
- Byte-aware output truncation (128KB ring buffer with multi-byte character safety)
- Zero npm runtime dependencies — only Bun + Node.js built-in APIs
