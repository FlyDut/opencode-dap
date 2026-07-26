export const zh: typeof import("./en.js").en = {
	schema: {
		program: "调试的目标路径；提示：Delve 支持 Go 包目录",
		args: "程序参数",
		adapter: "已适配的 adapter ID (gdb, lldb-dap, debugpy, dlv, rdbg, 或 dap.json 条目)",
		file: "来源文件",
		line: "来源行号",
		function: "函数名",
		name: "变量或数据名",
		condition: "断点条件",
		expression: "待求值的表达式",
		scopeId: "变量作用域 ID",
		variableRef: "变量引用",
		pid: "附加的进程 ID",
		port: "远程连接的端口",
		host: "远程连接的主机",
		levels: "最大栈帧数",
		memoryReference: "内存引用或地址",
		count: "待读取的字节数",
		dataId: "数据断点 ID",
		timeout: "每次请求的超时时间（秒）",
	},
	error: {
		dir_not_executable:
			"启动目标是一个目录而非可执行文件：{0}。请指定一个可执行文件的路径，或者换用一个支持包目录的调试适配器。",
		adapter_unavailable: "adapter '{0}' 未安装。已安装的 adapters: {1}",
		no_active_session: "没有活动的调试会话。请先启动或者附加/连接",
		no_threads: "调试器报告没找到线程。",
		launch_requires_program: "launch 需要指定 program",
		no_adapter: "没有可用的调试适配器。已安装的 adapters: {0}",
		attach_requires_pid_or_port: "attach 需要 pid 或端口",
		configure_launch_requires_program: "configureLaunch 需要指定 program",
		no_adapter_for_program: "未找到适合该程序的适配器。",
		breakpoint_requires_file_or_func: "setBreakpoint 需要 file+line 或 function",
		remove_breakpoint_requires_file_or_func: "removeBreakpoint 需要 file+line 或 function",
		func_breakpoint_requires_func: "setFunctionBreakpoint 需要指定 function",
		remove_func_breakpoint_requires_func: "removeFunctionBreakpoint 需要指定 function",
		inst_breakpoint_requires_ref: "setInstructionBreakpoint 需要指定 instructionReference",
		remove_inst_breakpoint_requires_ref: "removeInstructionBreakpoint 需要指定 instructionReference",
		data_breakpoint_requires_dataid: "setDataBreakpoint 需要指定 dataId",
		remove_data_breakpoint_requires_dataid: "removeDataBreakpoint 需要指定 dataId",
		evaluate_requires_expression: "evaluate 需要指定 expression",
		variables_requires_ref: "variables 需要 variableRef 或 scopeId",
		disassemble_requires_count: "disassemble 需要指定 instructionCount",
		disassemble_requires_memref:
			"disassemble 需要指定 memoryReference，除非当前停止位置包含指令指针引用",
		read_memory_requires_memref: "readMemory 需要指定 memoryReference",
		read_memory_requires_count: "readMemory 需要指定 count",
		no_stack_frame: "没有当前活动的栈帧。请先运行 stack_trace 或提供 frame_id。",
		child_session_unsupported: "DAP adapter {0} 不支持接受子会话连接",
		session_still_active: "调试会话 {0} 仍在运行中。请先结束当前会话再启动新会话。",
		run_in_terminal_no_command: "runInTerminal 请求未包含命令",
		config_done_failed: "DAP {0} 失败: {1}\nDAP configurationDone 同样失败: {2}",
		unsupported_action: "不支持的操作: {0}",
	},
	adapter: {
		debugpy_unavailable:
			"debugpy 不可用: PATH 中找不到 python，或者 debugpy 未安装。除非用户对 python 的使用有规定，默认优先安装在虚拟环境中，而如果使用系统解释器则使用 pip。",
		debugpy_missing_module: "debugpy 不可用: 请使用 'pip install debugpy' 安装",
		dlv_unavailable: "dlv 不可用: 请使用 'go install github.com/go-delve/delve/cmd/dlv@latest' 安装",
		rdbg_unavailable: "rdbg 不可用: 请使用 'gem install debug' 安装",
		js_debug_unavailable: `js-debug-adapter 不可用

可按以下操作步骤

    获取源码
        优先使用 Git 克隆：git clone https://github.com/microsoft/vscode-js-debug.git
        若 Git 不可用，则手动下载 ZIP 并解压到本地目录。

    依赖安装

        若用户已有自定义的 Node 依赖管理规范（如使用特定包管理器、私有源、锁文件等），必须严格遵循用户的既定流程，跳过以下默认规则。
        若无自定义规范，则按以下优先级选择包管理器：
            优先使用 pnpm（若全局可用）
            否则使用 npm

        安装时必须添加 --ignore-scripts 参数，以跳过 Playwright 等不必要的浏览器下载（如 pnpm install --ignore-scripts 或 npm install --ignore-scripts）。

    编译调试服务器
        在项目根目录下执行：npx gulp dapDebugServer（确保 gulp 已安装或通过 npx 临时调用）。

    设置环境变量
        添加或修改环境变量 JS_DEBUG_DAP_SERVER，其值必须为绝对路径，指向编译产物：
        <项目根目录>/dist/src/dapDebugServer.js

    最后
        确保环境变量生效，即可使用 debug 工具调用 js-debug-adapter

注意事项

    若编译失败，请检查 Node.js 版本（建议 ≥16）及 gulp 是否可执行。
    环境变量修改后，可能需要重新启动调试终端/进程方可生效，务必向用户进行确认！
    若用户自定义规范与上述冲突，以用户规范为最高优先级。`,
	},
	format: {
		session: "会话",
		adapter: "适配器",
		status: "状态",
		cwd: "工作目录",
		program: "程序",
		stop_reason: "停止原因",
		frame: "栈帧",
		instruction_pointer: "指令指针",
		location: "位置",
		configuration_pending: "配置：待发送 configurationDone；请设置断点后继续。",
		exit_code: "退出码",
		breakpoints_for: "文件 {0} 的断点",
		none: "(无)",
		verified: "已验证",
		pending: "待确认",
		line_l: "- 第 {0} 行: {1}{2}{3}",
		func_breakpoints: "函数断点",
		func_bp_line: "- {0}: {1}{2}{3}",
		stack_trace: "调用栈",
		empty: "(空)",
		sf_line: "- #{0} {1} @ {2}",
		threads: "线程",
		thread_line: "- {0}: {1}",
		scopes: "作用域",
		scope_line: "- {0}: ref={1}, expensive={2}{3}",
		yes: "是",
		no: "否",
		variables: "变量",
		var_line: "- {0} = {1}{2}{3}",
		disassembly: "反汇编",
		memory_at: "内存地址 {0}",
		no_readable_bytes: "(无可读取的字节)",
		unreadable_bytes: "不可读取的字节: {0}",
		modules: "模块",
		modules_header_id: "ID",
		modules_header_name: "名称",
		modules_header_path: "路径",
		modules_header_symbols: "符号",
		modules_header_range: "范围",
		loaded_sources: "已加载的源文件",
		inst_breakpoints: "指令断点",
		inst_bp_line: "- {0}: {1}{2}{3}{4}",
		data_bp_info: "数据断点信息: {0}",
		data_id: "数据 ID: {0}",
		not_available: "(不可用)",
		access_types: "访问类型: {0}",
		persistent: "持久化: {0}",
		data_breakpoints: "数据断点",
		data_bp_line: "- {0}: {1}{2}{3}{4}{5}",
		no_sessions: "没有调试会话。",
		sessions_line: "{0}: {1}",
		result: "结果: {0}",
		type: "类型: {0}",
		variables_ref: "变量引用: {0}",
		program_still_running: "程序在 {0}s 后仍在运行。请使用 pause 暂停并检查状态。",
		stopped_at: "{0} 停止于 {1}。",
		program_terminated: "程序已终止{0}。",
		program_running: "程序正在运行。",
		program_paused: "程序已暂停。",
		no_output_captured: "(未捕获到输出)",
		selected_adapter_launch: "已选择启动适配器: {0}{1}",
		selected_adapter_attach: "已选择附加适配器: {0}{1}",
		languages: " (语言: {0})",
		no_adapter_found_program: "未找到适用于该程序的适配器: {0}。可用的适配器: {1}",
		no_adapter_found_attach: "未找到可用于附加的适配器。可用的适配器: {0}",
		no_adapters_available: "没有可用的调试适配器。",
		available_adapters: "可用的适配器:\n{0}",
		terminated: "调试会话已结束。",
		disconnected: "调试会话已断开。",
		killed: "调试会话已被强制终止。",
		no_session_to_terminate: "没有要结束的调试会话。",
		no_session_to_disconnect: "没有待断开的调试会话。",
		no_session_to_kill: "没有要强制终止的调试会话。",
		configure_launch_adapter: "适配器: {0}",
		configure_launch_command: "命令: {0}",
		configure_launch_program: "程序: {0}",
		configure_launch_cwd: "工作目录: {0}",
		configure_launch_config: "启动配置: {0}",
	},
	config_warn: {
		invalid_override: "忽略无效的 DAP adapter 覆写（保留之前的配置）。",
		invalid_config: "忽略无效的 DAP adapter 配置。",
	},
	debug_prompt: `调试器访问。优先于 bash 使用，用于程序状态、断点、单步执行或线程检查。
同一时间只有一个活动会话。\`program\` 是目标路径，不是 shell 命令。
目录需要支持目录能力的适配器（例如 \`dlv\`）。
详细使用指南请使用 \`dap-debug\` skill。`,
	prompt: {
		system_prompt: "详细的 DAP 调试器使用指南（包括断点、流程控制、状态检查等），请使用 `dap-debug` skill。",
	},
};
