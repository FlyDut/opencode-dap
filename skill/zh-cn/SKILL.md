---
name: dap-debug
description: "使用 debug 工具通过 DAP 协议进行调试时使用。包含 launch/attach、断点管理、流程控制（continue/step/pause）、状态检查（threads/stack/variables/evaluate）、会话管理等完整操作指引。"
---

# DAP 调试工具使用指南

通过 Debug Adapter Protocol (DAP) 提供调试器访问。
用于启动或附加调试器、设置断点、单步执行、检查线程/堆栈/变量、对表达式求值、捕获输出以及中断挂起的程序。

<instruction>
- 在程序状态、断点、单步、线程检查或中断运行中进程时，你应当优先使用 `debug` 工具，而非 bash。
- `action: "launch"` 启动调试会话；`program` 为必填项，`adapter` 为可选项（会根据目标路径和工作区自动选择）。
  对于 Python，设置 `adapter: "debugpy"`，`program` 为目标 `.py` 文件；将解释器/脚本参数放入 `args`。
- `action: "attach"` 连接到现有进程：本地附加使用 `pid`，远程附加（在适配器支持的情况下）使用 `port`，`adapter` 用于强制指定某一调试器。
- **断点**：`set_breakpoint`/`remove_breakpoint` 需指定源文件位置（`file`+`line`）或函数（`function`）；可选 `condition` 用于条件断点。
  `set_function_breakpoint`/`remove_function_breakpoint` 用于显式的函数断点。
  `set_instruction_breakpoint`/`remove_instruction_breakpoint` 用于指令级断点。
  `set_data_breakpoint`/`remove_data_breakpoint` 用于数据断点。
- **流程控制**：`continue`（恢复运行；短暂等待以观察程序是停止还是继续运行）、`step_over`/`step_in`/`step_out`（单步执行）、`pause`（中断正在运行的程序以便检查状态）。
- **终止**：`terminate`、`disconnect`、`kill` 均可结束会话。
- **检查**：
  - `threads`：列出线程
  - `stack_trace`：当前停止线程的栈帧，可选 `levels` 控制数量
  - `scopes`：需提供 `frame_id` 或当前停止的帧
  - `variables`：需提供 `variable_ref` 或 `scope_id`
  - `evaluate`：需提供 `expression`；使用 `context: "repl"` 可发送原始调试器命令（如 `info registers`）
  - `output`：捕获的 stdout/stderr/控制台输出
  - `sessions`：已跟踪的调试会话列表
  - `loaded_sources`：已加载的源文件
  - `modules`：已加载的模块
  - `disassemble`：反汇编指令，需 `memory_reference` 和 `instruction_count`
  - `read_memory`：读取内存，需 `memory_reference` 和 `count`
- `select_adapter`：查看可用适配器或根据程序/进程选择适配器。
- `configure_launch`：查看适配器对指定程序的启动配置（不实际启动）。
- 超时按每次请求生效，而非针对整个会话生命周期。默认超时为 30 秒，限定范围 5-300 秒。
</instruction>

<caution>
- 同一时间仅支持一个活跃的调试会话。
- 某些适配器需要已启动的会话在目标实际运行前收到 `configurationDone`；如果工具提示配置尚未完成，请先设置断点，然后调用 `continue`。
- 适配器的可用性取决于本地二进制文件。常见内置：`gdb`、`lldb-dap`、`codelldb`、`debugpy`（`python -m debugpy.adapter`）、`dlv dap`、`js-debug-adapter`、`netcoredbg`、`kotlin-debug-adapter`、`rdbg`、`php-debug-adapter`、`bash-debug-adapter`、`dart debug_adapter`、`elixir-ls-debugger`。
- `program` 一般是可执行文件或调试目标，不能是目录或解析为工作区目录的解释器名称。除非 adapter 支持目录（例如 `dlv`，因为 Go 包路径是目录）。
- Python 调试需要 `debugpy`；如果适配器不可用，请用 `pip install debugpy` 安装。
- GDB 的 `evaluate` 在非 REPL 模式下会自动加 `print` 前缀以避免单字母变量歧义；若需执行 GDB 原生命令请使用 `context: "repl"`。
</caution>

<examples>
# 启动并检查挂起的程序
1. `debug(action: "launch", program: "./my_app")`
2. `debug(action: "set_breakpoint", file: "src/main.c", line: 42)`
3. `debug(action: "continue")`
4. 如果程序看起来挂起：`debug(action: "pause")`
5. 使用 `threads`、`stack_trace`、`scopes` 和 `variables` 检查状态

# 使用 debugpy 启动 Python 脚本
`debug(action: "launch", adapter: "debugpy", program: "scripts/job.py", args: ["--flag"])`

# 附加到进程
`debug(action: "attach", pid: 12345)`
`debug(action: "attach", port: 5678, adapter: "debugpy")`

# 通过 repl 发送原始调试器命令
`debug(action: "evaluate", expression: "info registers", context: "repl")`
`debug(action: "evaluate", expression: "bt full", context: "repl")`

# 检查变量和调用栈
`debug(action: "stack_trace", levels: 10)`
`debug(action: "variables", scope_id: 1000)`
`debug(action: "evaluate", expression: "my_var")`

# 查看所有可用适配器
`debug(action: "select_adapter")`
</examples>
