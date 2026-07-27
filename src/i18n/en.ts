export const en = {
	schema: {
		program: "debug target path; Delve accepts Go package directories",
		args: "program arguments",
		adapter: "configured adapter id (gdb, lldb-dap, debugpy, dlv, rdbg, or dap.json entry)",
		file: "source file",
		line: "source line",
		function: "function name",
		name: "variable or data name",
		condition: "breakpoint condition",
		expression: "expression to evaluate",
		scopeId: "scope variables reference",
		variableRef: "variable reference",
		pid: "process id for attach",
		port: "remote attach port",
		host: "remote attach host",
		levels: "max stack frames",
		memoryReference: "memory reference or address",
		count: "bytes to read",
		dataId: "data breakpoint id",
		mainClass: "Java: fully-qualified main class (e.g. com.xxx.Main)",
		projectName: "Java: Maven/Gradle project name (e.g. artifactId)",
		classPaths: "Java: absolute classpath directories",
	},
	error: {
		dir_not_executable:
			"launch program resolves to a directory: {0}. Pass an executable file path or choose an adapter that supports package directories.",
		adapter_unavailable: "adapter '{0}' is not available. Installed adapters: {1}",
		no_active_session: "No active debug session. Launch or attach first.",
		no_threads: "Debugger reported no threads.",
		launch_requires_program: "program is required for launch",
		no_adapter: "No debugger adapter available. Installed adapters: {0}",
		attach_requires_pid_or_port: "attach requires pid or port",
		configure_launch_requires_program: "program is required for configureLaunch",
		no_adapter_for_program: "No suitable adapter found for the given program.",
		breakpoint_requires_file_or_func: "setBreakpoint requires file+line or function",
		remove_breakpoint_requires_file_or_func: "removeBreakpoint requires file+line or function",
		func_breakpoint_requires_func: "function is required for setFunctionBreakpoint",
		remove_func_breakpoint_requires_func: "function is required for removeFunctionBreakpoint",
		inst_breakpoint_requires_ref: "instructionReference is required for setInstructionBreakpoint",
		remove_inst_breakpoint_requires_ref: "instructionReference is required for removeInstructionBreakpoint",
		data_breakpoint_requires_dataid: "dataId is required for setDataBreakpoint",
		remove_data_breakpoint_requires_dataid: "dataId is required for removeDataBreakpoint",
		evaluate_requires_expression: "expression is required for evaluate",
		variables_requires_ref: "variables requires variableRef or scopeId",
		disassemble_requires_count: "instructionCount is required for disassemble",
		disassemble_requires_memref:
			"disassemble requires memoryReference unless the current stop location has an instruction pointer reference",
		read_memory_requires_memref: "memoryReference is required for readMemory",
		read_memory_requires_count: "count is required for readMemory",
		no_stack_frame: "No active stack frame. Run stack_trace first or supply frame_id.",
		child_session_unsupported: "DAP adapter {0} cannot accept child session connections",
		session_still_active: "Debug session {0} is still active. Terminate it before launching another.",
		run_in_terminal_no_command: "runInTerminal request did not include a command",
		config_done_failed: "DAP {0} failed: {1}\nDAP configurationDone also failed: {2}",
		unsupported_action: "Unsupported action: {0}",
	},
	adapter: {
		debugpy_unavailable:
			"adapter 'debugpy' is not available: python not found in PATH, or debugpy not installed. Unless the user has specific python usage requirements, prefer installing in a virtual environment by default; if using the system interpreter, use pip.",
		debugpy_missing_module: "adapter 'debugpy' is not available: install with 'pip install debugpy'",
		dlv_unavailable: "adapter 'dlv' is not available: install with 'go install github.com/go-delve/delve/cmd/dlv@latest'",
		rdbg_unavailable: "adapter 'rdbg' is not available: install with 'gem install debug'",
		js_debug_unavailable: `js-debug-adapter is not available

Follow these steps:

    Get the source
        Prefer Git clone: git clone https://github.com/microsoft/vscode-js-debug.git
        If Git is unavailable, download the ZIP manually and extract to a local directory.

    Install dependencies
        If the user has custom Node dependency management conventions (e.g. specific package manager, private registry, lockfile, etc.), you must strictly follow the user's established workflow, skipping the default rules below.
        Without custom conventions, choose the package manager in this order:
            Prefer pnpm (if globally available)
            Otherwise use npm

        Always add --ignore-scripts when installing to skip unnecessary browser downloads like Playwright (e.g. pnpm install --ignore-scripts or npm install --ignore-scripts).

    Build the debug server
        Run in the project root: npx gulp dapDebugServer (ensure gulp is installed or invoke via npx).

    Set the environment variable
        Add or modify the JS_DEBUG_DAP_SERVER environment variable; its value must be an absolute path pointing to the build artifact:
        <project root>/dist/src/dapDebugServer.js

    Finally
        Ensure the environment variable takes effect, then you can use the debug tool to invoke js-debug-adapter.

Notes
    If the build fails, check the Node.js version (recommended >=16) and verify gulp is executable.
    After modifying the environment variable, you may need to restart the debug terminal/process for it to take effect — be sure to confirm with the user!
    If the user's custom conventions conflict with the above, the user's conventions take the highest priority.`,
	},
	format: {
		session: "Session",
		adapter: "Adapter",
		status: "Status",
		cwd: "CWD",
		program: "Program",
		stop_reason: "Stop reason",
		frame: "Frame",
		instruction_pointer: "Instruction pointer",
		location: "Location",
		configuration_pending: "Configuration: pending configurationDone; set breakpoints, then continue.",
		exit_code: "Exit code",
		breakpoints_for: "Breakpoints for {0}",
		none: "(none)",
		verified: "verified",
		pending: "pending",
		line_l: "- line {0}: {1}{2}{3}",
		func_breakpoints: "Function breakpoints",
		func_bp_line: "- {0}: {1}{2}{3}",
		stack_trace: "Stack trace",
		empty: "(empty)",
		sf_line: "- #{0} {1} @ {2}",
		threads: "Threads",
		thread_line: "- {0}: {1}",
		scopes: "Scopes",
		scope_line: "- {0}: ref={1}, expensive={2}{3}",
		yes: "yes",
		no: "no",
		variables: "Variables",
		var_line: "- {0} = {1}{2}{3}",
		disassembly: "Disassembly",
		memory_at: "Memory at {0}",
		no_readable_bytes: "(no readable bytes)",
		unreadable_bytes: "Unreadable bytes: {0}",
		modules: "Modules",
		modules_header_id: "ID",
		modules_header_name: "Name",
		modules_header_path: "Path",
		modules_header_symbols: "Symbols",
		modules_header_range: "Range",
		loaded_sources: "Loaded sources",
		inst_breakpoints: "Instruction breakpoints",
		inst_bp_line: "- {0}: {1}{2}{3}{4}",
		data_bp_info: "Data breakpoint info: {0}",
		data_id: "Data ID: {0}",
		not_available: "(not available)",
		access_types: "Access types: {0}",
		persistent: "Persistent: {0}",
		data_breakpoints: "Data breakpoints",
		data_bp_line: "- {0}: {1}{2}{3}{4}{5}",
		no_sessions: "No debug sessions.",
		sessions_line: "{0}: {1}",
		result: "Result: {0}",
		type: "Type: {0}",
		variables_ref: "Variables ref: {0}",
		program_still_running: "Program is still running after {0}s. Use pause to interrupt and inspect state.",
		stopped_at: "{0} stopped at {1}.",
		program_terminated: "Program terminated{0}.",
		program_running: "Program is running.",
		program_paused: "Program paused.",
		no_output_captured: "(no output captured)",
		selected_adapter_launch: "Selected adapter for launch: {0}{1}",
		selected_adapter_attach: "Selected adapter for attach: {0}{1}",
		languages: " (languages: {0})",
		no_adapter_found_program: "No adapter found for program: {0}. Available adapters: {1}",
		no_adapter_found_attach: "No adapter found for attach. Available adapters: {0}",
		no_adapters_available: "No debug adapters available.",
		available_adapters: "Available adapters:\n{0}",
		terminated: "Debug session terminated.",
		disconnected: "Debug session disconnected.",
		killed: "Debug session killed.",
		no_session_to_terminate: "No debug session to terminate.",
		no_session_to_disconnect: "No debug session to disconnect.",
		no_session_to_kill: "No debug session to kill.",
		configure_launch_adapter: "Adapter: {0}",
		configure_launch_command: "Command: {0}",
		configure_launch_program: "Program: {0}",
		configure_launch_cwd: "CWD: {0}",
		configure_launch_config: "Launch config: {0}",
	},
	config_warn: {
		invalid_override: "Ignoring invalid DAP adapter override (keeping previous config).",
		invalid_config: "Ignoring invalid DAP adapter config.",
	},
	debug_prompt: `Debugger access. Prefer over bash for program state, breakpoints, stepping, or thread inspection.
Only one active session at a time. \`program\` is a target path, not a shell command.
Directories need a directory-capable adapter (e.g. \`dlv\`).
For detailed usage guide, use the \`dap-debug\` skill.`
};
