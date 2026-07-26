# opencode-dap

[中文文档](README_zh.md)

DAP (Debug Adapter Protocol) client for OpenCode — ported from [oh-my-pi](https://github.com/anomalyco/oh-my-pi).

Lets AI coding agents debug programs via the Debug Adapter Protocol — supports 15 debug adapters covering ~19 languages. Drop it into OpenCode with a single `plugin` entry or use it as a standalone Bun/Node library.

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
| `java-debug` | Java | `python3 -u $JDTLS_HOME/java_dap_bridge.py` | see [Java Setup](#java) |
| `rdbg` | Ruby | `rdbg --open --command --` | `gem install debug` |
| `php-debug-adapter` | PHP | `php-debug-adapter` | VS Code extension |
| `bash-debug-adapter` | Bash/Shell | `bash-debug-adapter` | `npm install -g @vscode/bash-debug` |
| `dart-debug-adapter` | Dart | `dart debug_adapter` | Dart SDK |
| `flutter-debug-adapter` | Dart (Flutter) | `dart debug_adapter` | Flutter SDK |
| `elixir-ls-debugger` | Elixir | `elixir-ls-debugger` | [GitHub](https://github.com/elixir-lsp/elixir-ls) |

## Java

Java DAP debugging is special — there's no standalone debug adapter. Instead, the [java-debug](https://github.com/microsoft/vscode-java-debug) plugin runs inside [Eclipse JDTLS](https://github.com/eclipse-jdtls/eclipse.jdt.ls) as an OSGi bundle. This plugin ships a Python bridge script (`java_dap_bridge.py`) that:

1. Starts a dedicated JDTLS LSP instance (isolated from the main OpenCode LSP)
2. Completes the LSP handshake
3. Sends `vscode.java.startDebugSession` to obtain a DAP TCP port
4. Bridges stdin/stdout ↔ TCP so OpenCode speaks plain DAP

**Why a separate JDTLS instance?** JDTLS communicates over stdio — a single bidirectional pipe carrying LSP messages. OpenCode's LSP integration occupies that pipe exclusively. The bridge therefore launches a second JDTLS instance dedicated to DAP, with its own workspace at `~/.cache/jdtls-workspace-dap/`. To avoid re-importing Maven projects, the bridge automatically copies the LSP workspace (`~/.cache/jdtls-workspace/`) on first launch.

> **Recommendation** — Use [opencode-jdtls-launcher](https://github.com/FlyDut/opencode-jdtls-launcher) to manage your JDTLS installation. Its JVM parameters are tuned for OpenCode, and both LSP and DAP can share the same workspace directory, eliminating the copy step entirely.

### Prerequisites

| Component | Purpose | Download |
|-----------|---------|----------|
| Python ≥3.9 | Runs the bridge script |  |
| Eclipse JDTLS | Language server + debug host | [download](https://download.eclipse.org/jdtls/milestones/) |
| java-debug plugin | The DAP implementation inside JDTLS | [GitHub Releases](https://github.com/microsoft/vscode-java-debug/releases) |

After downloading JDTLS, unpack it to a directory (e.g. `~/.local/share/jdtls/`). The debug plugin jar goes into the same directory.

### Install the Bridge Script

This plugin ships `java_dap_bridge.py` inside its source tree. Since the plugin's installed location varies across environments, you must manually copy it to your JDTLS directory so the adapter can find it:

```bash
# Find the plugin directory (typically under node_modules or OpenCode's plugin cache)
# Then copy:
cp <plugin-dir>/src/dap/java_dap_bridge.py $JDTLS_HOME/
```

After copying, the adapter references it via `$JDTLS_HOME/java_dap_bridge.py`.

### Configuration (dap.json)

Adapter configuration is read from multiple locations, merged in priority order (lowest first):

| Priority | Location | Scope |
|----------|----------|-------|
| lowest | plugin defaults (`defaults.json`) | built-in |
| — | `~/.config/opencode/opencode-dap.json` | **global** — all projects |
| highest | `<project>/dap.json` (or `.opencode/dap.json`) | **project** — overrides globals |

Typically you set shared settings (JAVA_BIN, JDTLS_HOME) in the global config, and project-specific settings (mainClass, projectName, classPaths) in each project's `dap.json`.

#### Global config (`~/.config/opencode/opencode-dap.json`)

```json
{
  "adapters": {
    "java-debug": {
      "command": "python3",
      "args": ["-u", "$JDTLS_HOME/java_dap_bridge.py"],
      "env": {
        "JAVA_BIN": "/path/to/java/bin/java",
        "JDTLS_HOME": "/path/to/jdtls",
        "DEBUG_PLUGIN_JAR": "$JDTLS_HOME/com.microsoft.java.debug.plugin-0.53.2.jar"
      }
    }
  }
}
```

#### Project config (`<project>/dap.json`)

The `command` and `args` are inherited from the global config. Only set what differs per project — `mainClass`, `projectName`, `classPaths`, and optional overrides:

```json
{
  "adapters": {
    "java-debug": {
      "launchDefaults": {
        "mainClass": "com.example.Main",
        "classPaths": ["target/classes"]
      }
    }
  }
}
```

When both configs exist, fields are deep-merged: `launchDefaults`, `attachDefaults`, and `env` are merged recursively; other fields are overwritten.

### Maven / Gradle Projects

For projects with `pom.xml` or `build.gradle`, set `projectName` so the adapter resolves the full classpath from the build tool:

```json
"launchDefaults": {
    "mainClass": "com.example.Main",
    "projectName": "my-module",
    "classPaths": ["target/classes"]
}
```

The `projectName` must match a module name in your JDTLS workspace. For multi-module Maven projects, use the module's artifactId.

### Environment Variables

All variables go under `env` in your adapter config. Variables marked with `$VAR` or `${VAR}` syntax are expanded automatically — both in `args` (by the plugin) and in `env` values (by the bridge).

| Variable | Default | Description |
|----------|---------|-------------|
| `JDTLS_HOME` | `~/.local/bin/jdtls` | JDTLS installation root |
| `JAVA_BIN` | `$JAVA_HOME/bin/java` or `java` | Java executable |
| `JAVA_HOME` | — | Fallback for `JAVA_BIN` |
| `DEBUG_PLUGIN_JAR` | — | Path to `com.microsoft.java.debug.plugin-*.jar` (required) |
| `JDTLS_IMPORT_WAIT` | `15` | Seconds to wait after LSP init for Maven/Gradle import |
| `JDTLS_XMS` | `128m` | Initial JVM heap (DAP needs much less than LSP) |
| `JDTLS_XMX` | `512m` | Max JVM heap |
| `JDTLS_METASPACE_SIZE` | `128m` | Metaspace size |
| `JDTLS_MAX_METASPACE_SIZE` | `256m` | Max Metaspace |
| `DAP_HOST` | `127.0.0.1` | DAP server bind address |
| `DAP_CONNECT_TIMEOUT` | `30` | TCP connect timeout (seconds) |
| `LSP_INIT_TIMEOUT` | `60` | LSP initialize timeout (seconds) |
