# opencode-dap

DAP (Debug Adapter Protocol) client for OpenCode — ported from [oh-my-pi](https://github.com/anomalyco/oh-my-pi).

Lets AI coding agents debug programs via the Debug Adapter Protocol — supports 14 debug adapters covering ~18 languages. Drop it into OpenCode with a single `plugin` entry or use it as a standalone Bun/Node library.

## Source

[GitHub](https://github.com/debugtalk/opencode-dap)

## Quick Start

```bash
opencode plugin @flydut/opencode-dap
```

Restart OpenCode. The `debug` tool is available with 30+ actions. Debug sessions are automatically cleaned up on session idle/deleted.

### Upgrade

```bash
opencode plugin @flydut/opencode-dap --force
```

### Verify

```bash
grep "opencode-dap" ~/.local/share/opencode/log/opencode.log
```

Then in OpenCode, run `debug action=sessions` to confirm the tool is registered.

### Manual install (not recommended)

```bash
npm install @flydut/opencode-dap --save-dev
```

Then add to `opencode.json`:

```json
{ "plugin": ["@flydut/opencode-dap"] }
```

## Supported Adapters

| Adapter | Languages | Command | Install |
|---|---|---|---|
| `gdb` | C, C++, Rust | `gdb -i dap` | system package |
| `lldb-dap` | C, C++, ObjC, Swift, Rust, Zig | `lldb-dap` | `brew install llvm` (macOS), `apt install lldb` |
| `codelldb` | C, C++, Rust, Zig | `codelldb` | VS Code extension |
| `debugpy` | Python | `python -m debugpy.adapter` | `pip install debugpy` |
| `dlv` | Go | `dlv dap` | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| `js-debug-adapter` | JavaScript, TypeScript | `js-debug-adapter` | [GitHub](https://github.com/microsoft/vscode-js-debug)  |
| `netcoredbg` | C#, F# | `netcoredbg --interpreter=vscode` | [GitHub](https://github.com/Samsung/netcoredbg) |
| `kotlin-debug-adapter` | Kotlin | `kotlin-debug-adapter` | [GitHub](https://github.com/fwcd/kotlin-debug-adapter) |
| `rdbg` | Ruby | `rdbg --open --command --` | `gem install debug` |
| `php-debug-adapter` | PHP | `php-debug-adapter` | VS Code extension |
| `bash-debug-adapter` | Bash/Shell | `bash-debug-adapter` | `npm install -g @vscode/bash-debug` |
| `dart-debug-adapter` | Dart | `dart debug_adapter` | Dart SDK |
| `flutter-debug-adapter` | Dart (Flutter) | `dart debug_adapter` | Flutter SDK |
| `elixir-ls-debugger` | Elixir | `elixir-ls-debugger` | [GitHub](https://github.com/elixir-lsp/elixir-ls) |
