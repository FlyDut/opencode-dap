# opencode-dap

DAP（Debug Adapter Protocol）调试客户端，用于 OpenCode —— 从 [oh-my-pi](https://github.com/anomalyco/oh-my-pi) 移植而来。

让 AI 编程助手通过 DAP 协议调试程序——支持 15 种调试适配器，覆盖约 19 种语言。可通过单条 `plugin` 配置集成到 OpenCode，也可作为独立的 Bun/Node 库使用。

## 快速开始

```bash
opencode plugin @flydut/opencode-dap
```

重启 OpenCode。`debug` 工具即生效，支持 30+ 种操作。调试会话在会话空闲/删除时自动清理。

### 升级

```bash
opencode plugin @flydut/opencode-dap --force
```

### 验证

```bash
grep "opencode-dap" ~/.local/share/opencode/log/opencode.log
```

然后在 OpenCode 中运行 `debug action=sessions` 确认工具已注册。

### 手动安装（不推荐）

```bash
npm install @flydut/opencode-dap --save-dev
```

然后在 `opencode.json` 中添加：

```json
{ "plugin": ["@flydut/opencode-dap"] }
```

## 支持的适配器

| 适配器 | 语言 | 命令 | 安装方式 |
|---|---|---|---|
| `gdb` | C, C++, Rust | `gdb -i dap` | 系统包管理器 |
| `lldb-dap` | C, C++, ObjC, Swift, Rust, Zig | `lldb-dap` | `brew install llvm` (macOS), `apt install lldb` |
| `codelldb` | C, C++, Rust, Zig | `codelldb` | VS Code 扩展 |
| `debugpy` | Python | `python -m debugpy.adapter` | `pip install debugpy` |
| `dlv` | Go | `dlv dap` | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| `js-debug-adapter` | JavaScript, TypeScript | `js-debug-adapter` | [GitHub](https://github.com/microsoft/vscode-js-debug) |
| `netcoredbg` | C#, F# | `netcoredbg --interpreter=vscode` | [GitHub](https://github.com/Samsung/netcoredbg) |
| `kotlin-debug-adapter` | Kotlin | `kotlin-debug-adapter` | [GitHub](https://github.com/fwcd/kotlin-debug-adapter) |
| `java-debug` | Java | `python3 -u $JDTLS_HOME/java_dap_bridge.py` | 见 [Java 配置](#java) |
| `rdbg` | Ruby | `rdbg --open --command --` | `gem install debug` |
| `php-debug-adapter` | PHP | `php-debug-adapter` | VS Code 扩展 |
| `bash-debug-adapter` | Bash/Shell | `bash-debug-adapter` | `npm install -g @vscode/bash-debug` |
| `dart-debug-adapter` | Dart | `dart debug_adapter` | Dart SDK |
| `flutter-debug-adapter` | Dart (Flutter) | `dart debug_adapter` | Flutter SDK |
| `elixir-ls-debugger` | Elixir | `elixir-ls-debugger` | [GitHub](https://github.com/elixir-lsp/elixir-ls) |

## 配置（dap.json）

适配器配置从多个位置读取，按优先级合并（从低到高）：

| 优先级 | 位置 | 作用域 |
|--------|------|--------|
| 最低 | 插件默认配置 (`defaults.json`) | 内置 |
| — | `~/.config/opencode/opencode-dap.json` | **全局** — 所有项目 |
| 最高 | `<项目>/dap.json`（或 `.opencode/dap.json`） | **项目** — 覆盖全局配置 |

## Java

Java DAP 调试比较特殊——没有独立的调试适配器。Java 调试功能（[java-debug](https://github.com/microsoft/vscode-java-debug)）以 OSGi 插件的形式运行在 [Eclipse JDTLS](https://github.com/eclipse-jdtls/eclipse.jdt.ls) 内部。本插件内置了一个 Python 桥接脚本（`java_dap_bridge.py`），其工作流程为：

1. 启动一个独立的 JDTLS LSP 实例（与 OpenCode 主 LSP 隔离）
2. 完成 LSP 握手
3. 发送 `vscode.java.startDebugSession` 获取 DAP TCP 端口
4. 将 stdin/stdout 与 DAP TCP 桥接，使 OpenCode 可以使用标准 DAP 协议通信

**为什么需要独立JDTLS实例？** Opencode JDTLS 通过 stdio 通信——一条双向管道承载全部 LSP 消息。OpenCode 的 LSP 集成独占该管道，无法同时用于 DAP 调试。因此桥接脚本启动第二个 JDTLS 实例专用于 DAP，使用独立工作区 `~/.cache/jdtls-workspace-dap/`。为避免 Maven 项目重复导入，桥接脚本在首次启动时自动复制 LSP 工作区（`~/.cache/jdtls-workspace/`）。

> **推荐** —— 使用 [opencode-jdtls-launcher](https://github.com/FlyDut/opencode-jdtls-launcher) 管理 JDTLS 安装。其 JVM 参数针对大型项目进行了优化，虽然 LSP 和 DAP 依然无法复用同一个JDTLS实例，但 LSP 与 DAP 可共用同一工作区目录，如果两者都开启NEED_REGEN_CDS，还可复用同一个CDS存档（要求JDTLS和JDK版本相同）。

### 前置依赖

| 组件 | 用途 | 下载 |
|------|------|------|
| Python ≥3.9 | 运行桥接脚本 |  |
| Eclipse JDTLS | 语言服务器 + 调试宿主 | [下载](https://download.eclipse.org/jdtls/milestones/) |
| java-debug 插件 | JDTLS 内部的 DAP 实现 | [GitHub Releases](https://github.com/microsoft/vscode-java-debug/releases) |

下载 JDTLS 后解压到某个目录（例如 `~/.local/share/jdtls/`）。调试插件 jar 放在同一目录或 `plugins/` 子目录下。


JDTLS_HOME、DEBUG_PLUGIN_JAR 必须添加 ，我建议将它们放在全局配置中
mainClass、projectName、classPaths 非必须，AI可以通过工具参数指定。但是如果不是临时文件，建议添加项目配置，减少AI犯错概率

#### 全局配置 (`~/.config/opencode/opencode-dap.json`)

```json
{
  "adapters": {
    "java-debug": {
      "env": {
        "JDTLS_HOME": "/path/to/jdtls",
        "DEBUG_PLUGIN_JAR": "$JDTLS_HOME/com.microsoft.java.debug.plugin-0.53.2.jar"
      }
    }
  }
}
```

#### 项目配置 (`<项目根目录>/dap.json`)

`command` 和 `args` 从全局配置继承。只写项目间不同的部分——`mainClass`、`projectName`、`classPaths` 以及可选覆盖：
`projectName` 必须与 JDTLS 工作区中的模块名匹配。对于多模块 Maven 项目，使用对应模块的 artifactId。

```json
{
  "adapters": {
    "java-debug": {
      "launchDefaults": {
        "mainClass": "com.example.Main",
        "projectName": "artifactId",
        "classPaths": ["target/classes"]
      }
    }
  }
}
```

两份配置同时存在时，字段按深度合并：`launchDefaults`、`attachDefaults`、`env` 递归合并；其他字段直接覆盖。

### 桥接器

桥接器（`java_dap_bridge.py`）内置在插件中，通过 `$OPC_DAP_ROOT` 变量自动定位——无需手动复制。默认适配器配置已引用 `$OPC_DAP_ROOT/src/dap/java_dap_bridge.py`。

如需覆盖路径（例如使用自定义桥接脚本），在 `dap.json` 中设置 `args` 即可。


### 环境变量

所有变量放在适配器配置的 `env` 中。`$VAR` 或 `${VAR}` 语法会被自动展开——`args` 中的变量由插件展开，`env` 值中的变量由桥接脚本展开。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JDTLS_HOME` | — | JDTLS 安装根目录 |
| `JAVA_HOME` | `java` | $JAVA_HOME/bin/java |
| `DEBUG_PLUGIN_JAR` | — | `com.microsoft.java.debug.plugin-*.jar` 的路径（必填） |
| `JDTLS_IMPORT_WAIT` | `15` | JDTLS 初始化后等待 Maven/Gradle 导入的秒数 |
| `JDTLS_XMS` | `128m` | JVM 初始堆大小（DAP 比 LSP 需要的少得多） |
| `JDTLS_XMX` | `512m` | JVM 最大堆大小 |
| `JDTLS_METASPACE_SIZE` | `128m` | Metaspace 大小 |
| `JDTLS_MAX_METASPACE_SIZE` | `256m` | 最大 Metaspace |
| `DAP_HOST` | `127.0.0.1` | DAP 服务器绑定地址 |
| `DAP_CONNECT_TIMEOUT` | `30` | TCP 连接超时（秒） |
| `LSP_INIT_TIMEOUT` | `60` | JDTLS 初始化超时（秒） |
