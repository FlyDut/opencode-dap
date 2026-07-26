import type {
	DapBreakpointRecord,
	DapDataBreakpointInfoResponse,
	DapDataBreakpointRecord,
	DapDisassembledInstruction,
	DapEvaluateResponse,
	DapFunctionBreakpointRecord,
	DapInstructionBreakpointRecord,
	DapModule,
	DapScope,
	DapSessionSummary,
	DapSource,
	DapStackFrame,
	DapThread,
	DapVariable,
} from "./dap/types.js";
import { t } from "./i18n.js";

export function formatLocation(snapshot: DapSessionSummary | undefined): string | null {
	if (!snapshot?.source?.path || snapshot.line === undefined) {
		return null;
	}
	return `${snapshot.source.path}:${snapshot.line}${snapshot.column !== undefined ? `:${snapshot.column}` : ""}`;
}

export function formatSessionSnapshot(snapshot: DapSessionSummary): string[] {
	const lines = [
		`${t("format.session")} ${snapshot.id}`,
		`${t("format.adapter")}: ${snapshot.adapter}`,
		`${t("format.status")}: ${snapshot.status}`,
		`${t("format.cwd")}: ${snapshot.cwd}`,
	];
	if (snapshot.program) lines.push(`${t("format.program")}: ${snapshot.program}`);
	if (snapshot.stopReason) lines.push(`${t("format.stop_reason")}: ${snapshot.stopReason}`);
	if (snapshot.frameName) lines.push(`${t("format.frame")}: ${snapshot.frameName}`);
	if (snapshot.instructionPointerReference) {
		lines.push(`${t("format.instruction_pointer")}: ${snapshot.instructionPointerReference}`);
	}
	const location = formatLocation(snapshot);
	if (location) lines.push(`${t("format.location")}: ${location}`);
	if (snapshot.needsConfigurationDone) {
		lines.push(t("format.configuration_pending"));
	}
	if (snapshot.exitCode !== undefined) lines.push(`${t("format.exit_code")}: ${snapshot.exitCode}`);
	return lines;
}

export function formatBreakpoints(filePath: string, breakpoints: DapBreakpointRecord[]): string {
	const lines = [t("format.breakpoints_for", filePath)];
	if (breakpoints.length === 0) {
		lines.push(t("format.none"));
		return lines.join("\n");
	}
	for (const breakpoint of breakpoints) {
		lines.push(
			t("format.line_l",
				String(breakpoint.line),
				breakpoint.verified ? t("format.verified") : t("format.pending"),
				breakpoint.condition ? ` if ${breakpoint.condition}` : "",
				breakpoint.message ? ` (${breakpoint.message})` : "",
			),
		);
	}
	return lines.join("\n");
}

function formatFunctionBreakpoints(breakpoints: DapFunctionBreakpointRecord[]): string {
	const lines = [t("format.func_breakpoints")];
	if (breakpoints.length === 0) {
		lines.push(t("format.none"));
		return lines.join("\n");
	}
	for (const breakpoint of breakpoints) {
		lines.push(
			t("format.func_bp_line",
				breakpoint.name,
				breakpoint.verified ? t("format.verified") : t("format.pending"),
				breakpoint.condition ? ` if ${breakpoint.condition}` : "",
				breakpoint.message ? ` (${breakpoint.message})` : "",
			),
		);
	}
	return lines.join("\n");
}

export function formatStackFrames(frames: DapStackFrame[]): string {
	const lines = [t("format.stack_trace")];
	if (frames.length === 0) {
		lines.push(t("format.empty"));
		return lines.join("\n");
	}
	for (const frame of frames) {
		const location = frame.source?.path
			? `${frame.source.path}:${frame.line}:${frame.column}`
			: `<unknown>:${frame.line}:${frame.column}`;
		lines.push(t("format.sf_line", String(frame.id), frame.name, location));
	}
	return lines.join("\n");
}

export function formatThreads(threads: DapThread[]): string {
	const lines = [t("format.threads")];
	if (threads.length === 0) {
		lines.push(t("format.none"));
		return lines.join("\n");
	}
	for (const thread of threads) {
		lines.push(t("format.thread_line", String(thread.id), thread.name));
	}
	return lines.join("\n");
}

export function formatScopes(scopes: DapScope[]): string {
	const lines = [t("format.scopes")];
	if (scopes.length === 0) {
		lines.push(t("format.none"));
		return lines.join("\n");
	}
	for (const scope of scopes) {
		lines.push(
			t("format.scope_line",
				scope.name,
				String(scope.variablesReference),
				scope.expensive ? t("format.yes") : t("format.no"),
				scope.presentationHint ? `, hint=${scope.presentationHint}` : "",
			),
		);
	}
	return lines.join("\n");
}

export function formatVariables(variables: DapVariable[]): string {
	const lines = [t("format.variables")];
	if (variables.length === 0) {
		lines.push(t("format.none"));
		return lines.join("\n");
	}
	for (const variable of variables) {
		lines.push(
			t("format.var_line",
				variable.name,
				variable.value,
				variable.type ? ` (${variable.type})` : "",
				variable.variablesReference > 0 ? ` [ref=${variable.variablesReference}]` : "",
			),
		);
	}
	return lines.join("\n");
}

function formatSourceLabel(source: DapSource | undefined, line?: number, column?: number): string | null {
	if (!source?.path && !source?.name) {
		return null;
	}
	const base = source.path ?? source.name ?? "<unknown>";
	if (line === undefined) {
		return base;
	}
	return `${base}:${line}${column !== undefined ? `:${column}` : ""}`;
}

export function formatDisassemble(instructions: DapDisassembledInstruction[]): string {
	const lines = [t("format.disassembly")];
	if (instructions.length === 0) {
		lines.push(t("format.empty"));
		return lines.join("\n");
	}
	const addressWidth = Math.max(...instructions.map(instruction => instruction.address.length));
	const bytesWidth = Math.max(...instructions.map(instruction => instruction.instructionBytes?.length ?? 0), 2);
	for (const instruction of instructions) {
		const location = formatSourceLabel(instruction.location, instruction.line, instruction.column);
		const parts = [
			instruction.address.padEnd(addressWidth),
			(instruction.instructionBytes ?? "").padEnd(bytesWidth),
			instruction.instruction,
		];
		if (instruction.symbol) {
			parts.push(`<${instruction.symbol}>`);
		}
		if (location) {
			parts.push(`[${location}]`);
		}
		lines.push(
			parts
				.filter(part => part.length > 0)
				.join("  ")
				.trimEnd(),
		);
	}
	return lines.join("\n");
}

export function formatReadMemory(address: string, data: string | undefined, unreadableBytes?: number): string {
	const lines = [t("format.memory_at", address)];
	const buffer = data ? Buffer.from(data, "base64") : Buffer.alloc(0);
	if (buffer.length === 0) {
		lines.push(t("format.no_readable_bytes"));
	} else {
		for (let offset = 0; offset < buffer.length; offset += 16) {
			const chunk = buffer.subarray(offset, offset + 16);
			const hex = Array.from(chunk, byte => byte.toString(16).padStart(2, "0")).join(" ");
			const ascii = Array.from(chunk, byte => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".")).join("");
			lines.push(
				`${(offset === 0 ? address : `+0x${offset.toString(16)}`).padEnd(18)} ${hex.padEnd(47)} |${ascii}|`,
			);
		}
	}
	if (unreadableBytes !== undefined && unreadableBytes > 0) {
		lines.push(t("format.unreadable_bytes", String(unreadableBytes)));
	}
	return lines.join("\n");
}

function formatTable(headers: string[], rows: string[][]): string {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map(row => (row[index] ?? "").length)),
	);
	const formatRow = (row: string[]) => row.map((cell, index) => (cell ?? "").padEnd(widths[index]!)).join("  ");
	return [formatRow(headers), formatRow(widths.map(width => "-".repeat(width))), ...rows.map(formatRow)].join("\n");
}

export function formatModules(modules: DapModule[]): string {
	if (modules.length === 0) {
		return `${t("format.modules")}:\n${t("format.none")}`;
	}
	return [
		t("format.modules"),
		formatTable(
			[t("format.modules_header_id"), t("format.modules_header_name"), t("format.modules_header_path"), t("format.modules_header_symbols"), t("format.modules_header_range")],
			modules.map(module => [
				String(module.id),
				module.name,
				module.path ?? "",
				module.symbolStatus ?? "",
				module.addressRange ?? "",
			]),
		),
	].join("\n");
}

export function formatLoadedSources(sources: DapSource[]): string {
	const lines = [t("format.loaded_sources")];
	if (sources.length === 0) {
		lines.push(t("format.none"));
		return lines.join("\n");
	}
	for (const source of sources) {
		const label = source.path ?? source.name ?? "<unknown>";
		lines.push(`- ${label}${source.sourceReference !== undefined ? ` [ref=${source.sourceReference}]` : ""}`);
	}
	return lines.join("\n");
}

function formatInstructionBreakpoints(breakpoints: DapInstructionBreakpointRecord[]): string {
	const lines = [t("format.inst_breakpoints")];
	if (breakpoints.length === 0) {
		lines.push(t("format.none"));
		return lines.join("\n");
	}
	for (const breakpoint of breakpoints) {
		const location = `${breakpoint.instructionReference}${breakpoint.offset !== undefined ? `+${breakpoint.offset}` : ""}`;
		lines.push(
			t("format.inst_bp_line",
				location,
				breakpoint.verified ? t("format.verified") : t("format.pending"),
				breakpoint.condition ? ` if ${breakpoint.condition}` : "",
				breakpoint.hitCondition ? ` after ${breakpoint.hitCondition}` : "",
				breakpoint.message ? ` (${breakpoint.message})` : "",
			),
		);
	}
	return lines.join("\n");
}

export function formatDataBreakpointInfo(info: DapDataBreakpointInfoResponse): string {
	const lines = [t("format.data_bp_info", info.description)];
	lines.push(t("format.data_id", info.dataId ?? t("format.not_available")));
	if (info.accessTypes && info.accessTypes.length > 0) {
		lines.push(t("format.access_types", info.accessTypes.join(", ")));
	}
	if (info.canPersist !== undefined) {
		lines.push(t("format.persistent", info.canPersist ? t("format.yes") : t("format.no")));
	}
	return lines.join("\n");
}

function formatDataBreakpoints(breakpoints: DapDataBreakpointRecord[]): string {
	const lines = [t("format.data_breakpoints")];
	if (breakpoints.length === 0) {
		lines.push(t("format.none"));
		return lines.join("\n");
	}
	for (const breakpoint of breakpoints) {
		lines.push(
			t("format.data_bp_line",
				breakpoint.dataId,
				breakpoint.verified ? t("format.verified") : t("format.pending"),
				breakpoint.accessType ? ` (${breakpoint.accessType})` : "",
				breakpoint.condition ? ` if ${breakpoint.condition}` : "",
				breakpoint.hitCondition ? ` after ${breakpoint.hitCondition}` : "",
				breakpoint.message ? ` (${breakpoint.message})` : "",
			),
		);
	}
	return lines.join("\n");
}

export function formatCustomResponse(command: string, body: unknown): string {
	let serialized = "";
	try {
		serialized = JSON.stringify(body, null, 2) ?? "null";
	} catch {
		serialized = Bun.inspect(body);
	}
	return `${command} response:\n${serialized}`;
}

export function formatSessions(sessions: DapSessionSummary[]): string {
	if (sessions.length === 0) {
		return t("format.no_sessions");
	}
	return sessions
		.map(session => {
			const location = formatLocation(session);
			return [
				t("format.sessions_line", session.id, session.status),
				`  adapter=${session.adapter}`,
				`  cwd=${session.cwd}`,
				...(session.program ? [`  program=${session.program}`] : []),
				...(location ? [`  location=${location}`] : []),
				...(session.stopReason ? [`  reason=${session.stopReason}`] : []),
			].join("\n");
		})
		.join("\n\n");
}

export function formatEvaluate(evaluation: DapEvaluateResponse): string {
	const lines = [t("format.result", evaluation.result)];
	if (evaluation.type) lines.push(t("format.type", evaluation.type));
	if (evaluation.variablesReference > 0) {
		lines.push(t("format.variables_ref", String(evaluation.variablesReference)));
	}
	return lines.join("\n");
}

export function formatSetBreakpoint(filePath: string, breakpoints: DapBreakpointRecord[]): string {
	return formatBreakpoints(filePath, breakpoints);
}

export function formatSetDataBreakpoint(breakpoints: DapDataBreakpointRecord[]): string {
	return formatDataBreakpoints(breakpoints);
}

export function formatSetFunctionBreakpoint(breakpoints: DapFunctionBreakpointRecord[]): string {
	return formatFunctionBreakpoints(breakpoints);
}

export function formatSetInstructionBreakpoint(breakpoints: DapInstructionBreakpointRecord[]): string {
	return formatInstructionBreakpoints(breakpoints);
}

export function buildOutcomeText(
	snapshot: DapSessionSummary,
	state: string,
	timedOut: boolean,
	timeoutSec: number,
	verb: string,
): string {
	const lines = formatSessionSnapshot(snapshot);
	if (timedOut) {
		lines.push(t("format.program_still_running", String(timeoutSec)));
		return lines.join("\n");
	}
	if (state === "stopped") {
		lines.push(t("format.stopped_at", verb, formatLocation(snapshot) ?? "unknown location"));
		return lines.join("\n");
	}
	if (state === "terminated") {
		lines.push(
			t("format.program_terminated", snapshot.exitCode !== undefined ? ` with exit code ${snapshot.exitCode}` : ""),
		);
		return lines.join("\n");
	}
	lines.push(t("format.program_running"));
	return lines.join("\n");
}

export function formatContinue(
	snapshot: DapSessionSummary,
	timedOut: boolean,
	timeoutSec: number,
	state: string,
): string {
	return buildOutcomeText(snapshot, state, timedOut, timeoutSec, "Continue");
}

export function formatStep(
	snapshot: DapSessionSummary,
	timedOut: boolean,
	timeoutSec: number,
	state: string,
	stepType: "stepOver" | "stepIn" | "stepOut",
): string {
	const verbLabels: Record<string, string> = {
		stepOver: "Step over",
		stepIn: "Step in",
		stepOut: "Step out",
	};
	return buildOutcomeText(snapshot, state, timedOut, timeoutSec, verbLabels[stepType] ?? "Step");
}

export function formatPause(snapshot: DapSessionSummary): string {
	const lines = formatSessionSnapshot(snapshot);
	lines.push(t("format.program_paused"));
	return lines.join("\n");
}

export function formatOutput(output: string): string {
	return output.length > 0 ? output : t("format.no_output_captured");
}
