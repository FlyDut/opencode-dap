import { tool } from "@opencode-ai/plugin";
import type { PluginInput } from "@opencode-ai/plugin";
import { z } from "zod";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { dapSessionManager } from "./dap/session.js";
import {
  getAvailableAdapters,
  getAdapterConfigs,
  selectLaunchAdapter,
  selectAttachAdapter,
  resolveLaunchOverrides,
} from "./dap/config.js";
import type {
  DapContinueOutcome,
  DapResolvedAdapter,
  DapSessionSummary,
  LaunchProgramKind,
} from "./dap/types.js";
import * as format from "./format.js";
import { t } from "./i18n.js";

// ── Schema ────────────────────────────────────────────────────────────────────

const debugSchema = {
  action: z.enum([
    "launch",
    "attach",
    "terminate",
    "disconnect",
    "kill",
    "selectAdapter",
    "configureLaunch",
    "setBreakpoint",
    "setFunctionBreakpoint",
    "setInstructionBreakpoint",
    "setDataBreakpoint",
    "removeBreakpoint",
    "removeFunctionBreakpoint",
    "removeInstructionBreakpoint",
    "removeDataBreakpoint",
    "stackTrace",
    "scopes",
    "variables",
    "evaluate",
    "continue",
    "pause",
    "stepOver",
    "stepIn",
    "stepOut",
    "threads",
    "disassemble",
    "readMemory",
    "loadedSources",
    "modules",
    "output",
    "sessions",
  ]),
  program: z.string().optional().describe(t("schema.program")),
  args: z.array(z.string()).optional().describe(t("schema.args")),
  adapter: z.string().optional().describe(t("schema.adapter")),
  cwd: z.string().optional(),
  file: z.string().optional().describe(t("schema.file")),
  line: z.number().optional().describe(t("schema.line")),
  function: z.string().optional().describe(t("schema.function")),
  name: z.string().optional().describe(t("schema.name")),
  condition: z.string().optional().describe(t("schema.condition")),
  hitCondition: z.string().optional(),
  expression: z.string().optional().describe(t("schema.expression")),
  context: z.enum(["watch", "repl", "hover", "clipboard", "variables"]).optional(),
  frameId: z.number().optional(),
  scopeId: z.number().optional().describe(t("schema.scopeId")),
  variableRef: z.number().optional().describe(t("schema.variableRef")),
  pid: z.number().optional().describe(t("schema.pid")),
  port: z.number().optional().describe(t("schema.port")),
  host: z.string().optional().describe(t("schema.host")),
  levels: z.number().optional().describe(t("schema.levels")),
  memoryReference: z.string().optional().describe(t("schema.memoryReference")),
  instructionReference: z.string().optional(),
  instructionCount: z.number().optional(),
  instructionOffset: z.number().optional(),
  count: z.number().optional().describe(t("schema.count")),
  dataId: z.string().optional().describe(t("schema.dataId")),
  accessType: z.enum(["read", "write", "readWrite"]).optional(),
  offset: z.number().optional(),
  resolveSymbols: z.boolean().optional(),
  startModule: z.number().optional(),
  moduleCount: z.number().optional(),
  timeout: z.number().optional().describe(t("schema.timeout")),
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function isEnoent(error: unknown): boolean {
  if (error instanceof Error && "code" in error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  return false;
}

async function classifyLaunchProgram(program: string): Promise<LaunchProgramKind> {
  try {
    return (await stat(program)).isDirectory() ? "directory" : "file";
  } catch (error) {
    if (isEnoent(error)) return "missing";
    throw error;
  }
}

function validateLaunchProgram(
  program: string,
  cwd: string,
  programKind: LaunchProgramKind,
  adapter: DapResolvedAdapter,
): void {
  if (programKind !== "directory" || adapter.acceptsDirectoryProgram) return;
  const displayPath = path.relative(cwd, program) || program;
  throw new Error(t("error.dir_not_executable", displayPath));
}

function getConfiguredAdapters(cwd: string): string {
  const adapters = getAvailableAdapters(cwd).map(a => a.name);
  return adapters.length > 0 ? adapters.join(", ") : "none";
}

const ADAPTER_UNAVAILABLE_MESSAGES: Readonly<Record<string, string>> = {
  debugpy: t("adapter.debugpy_unavailable"),
  dlv: t("adapter.dlv_unavailable"),
  rdbg: t("adapter.rdbg_unavailable"),
  "js-debug-adapter": t("adapter.js_debug_unavailable"),
};

function formatAdapterUnavailable(adapterName: string, cwd: string): string {
  if (ADAPTER_UNAVAILABLE_MESSAGES[adapterName]) {
    return ADAPTER_UNAVAILABLE_MESSAGES[adapterName]!;
  }
  return t("error.adapter_unavailable", adapterName, getConfiguredAdapters(cwd));
}

function getActiveSessionSnapshot(): DapSessionSummary {
  const snapshot = dapSessionManager.getActiveSession();
  if (!snapshot) {
    throw new Error(t("error.no_active_session"));
  }
  return snapshot;
}

async function resolveThreadIdForSession(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<number> {
  const snapshot = getActiveSessionSnapshot();
  if (snapshot.threadId !== undefined) return snapshot.threadId;
  const response = await dapSessionManager.threads(signal, timeoutMs);
  const thread = response.threads[0];
  if (!thread) throw new Error(t("error.no_threads"));
  return thread.id;
}

// ── Plugin ─────────────────────────────────────────────────────────────────────

export async function opencodeDapPlugin(input: PluginInput) {
  const debugDescription = t("debug_prompt");
  const configs = getAdapterConfigs(input.directory);
  const javaEnabled = !!configs["java-debug"];

  const debugArgs = javaEnabled
    ? {
        ...debugSchema,
        mainClass: z.string().optional().describe(t("schema.mainClass")),
        projectName: z.string().optional().describe(t("schema.projectName")),
        classPaths: z.array(z.string()).optional().describe(t("schema.classPaths")),
      }
    : debugSchema;

  return {
    tool: {
      debug: tool({
        description: debugDescription.trim(),
        args: debugArgs,
        async execute(args, ctx) {
          const timeoutSec: number = args.timeout ?? 30;

          switch (args.action) {
            case "launch": {
              if (!args.program) {
                throw new Error(t("error.launch_requires_program"));
              }
              const commandCwd = args.cwd ? path.resolve(args.cwd) : ctx.directory;
              const program = path.resolve(commandCwd, args.program);
              const programKind = await classifyLaunchProgram(program);
              const selection = selectLaunchAdapter(program, commandCwd, args.adapter, programKind);
              if (selection.kind === "unavailable") {
                throw new Error(formatAdapterUnavailable(selection.adapterName, commandCwd));
              }
              if (selection.kind === "none") {
                throw new Error(t("error.no_adapter", getConfiguredAdapters(commandCwd)));
              }
              const { adapter } = selection;
              validateLaunchProgram(program, commandCwd, programKind, adapter);
              const extraLaunchArguments = resolveLaunchOverrides(adapter, program, programKind);
              if (adapter.name === "java-debug") {
                const jargs = args as { mainClass?: string; projectName?: string; classPaths?: string[] };
                if (jargs.mainClass) extraLaunchArguments.mainClass = jargs.mainClass;
                if (jargs.projectName) extraLaunchArguments.projectName = jargs.projectName;
                if (jargs.classPaths) extraLaunchArguments.classPaths = jargs.classPaths;
              }
              const snapshot = await dapSessionManager.launch(
                { adapter, program, args: args.args, cwd: commandCwd, extraLaunchArguments },
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSessionSnapshot(snapshot).join("\n");
            }

            case "attach": {
              if (args.pid === undefined && args.port === undefined) {
                throw new Error(t("error.attach_requires_pid_or_port"));
              }
              const commandCwd = args.cwd ? path.resolve(args.cwd) : ctx.directory;
              const adapter = selectAttachAdapter(commandCwd, args.adapter, args.port);
              if (!adapter) {
                if (args.adapter) {
                  throw new Error(formatAdapterUnavailable(args.adapter, commandCwd));
                }
                throw new Error(t("error.adapter_unavailable", "", getConfiguredAdapters(commandCwd)));
              }
              const snapshot = await dapSessionManager.attach(
                { adapter, cwd: commandCwd, pid: args.pid, port: args.port, host: args.host },
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSessionSnapshot(snapshot).join("\n");
            }

            case "terminate": {
              const snapshot = await dapSessionManager.terminate(ctx.abort, timeoutSec * 1000);
              if (!snapshot) {
                return t("format.no_session_to_terminate");
              }
              const lines = format.formatSessionSnapshot(snapshot);
              lines.push(t("format.terminated"));
              return lines.join("\n");
            }

            case "disconnect": {
              const snapshot = await dapSessionManager.terminate(ctx.abort, timeoutSec * 1000);
              if (!snapshot) {
                return t("format.no_session_to_disconnect");
              }
              const lines = format.formatSessionSnapshot(snapshot);
              lines.push(t("format.disconnected"));
              return lines.join("\n");
            }

            case "kill": {
              const snapshot = await dapSessionManager.terminate(ctx.abort, timeoutSec * 1000);
              if (!snapshot) {
                return t("format.no_session_to_kill");
              }
              const lines = format.formatSessionSnapshot(snapshot);
              lines.push(t("format.killed"));
              return lines.join("\n");
            }

            case "selectAdapter": {
              const commandCwd = args.cwd ? path.resolve(args.cwd) : ctx.directory;
              if (args.program) {
                const program = path.resolve(commandCwd, args.program);
                const programKind = await classifyLaunchProgram(program);
                const selection = selectLaunchAdapter(program, commandCwd, args.adapter, programKind);
                if (selection.kind === "adapter") {
                  return t("format.selected_adapter_launch",
                    selection.adapter.name,
                    selection.adapter.languages.length > 0
                      ? t("format.languages", selection.adapter.languages.join(", "))
                      : "",
                  );
                }
                if (selection.kind === "unavailable") {
                  throw new Error(formatAdapterUnavailable(selection.adapterName, commandCwd));
                }
                return t("format.no_adapter_found_program", args.program, getConfiguredAdapters(commandCwd));
              }
              if (args.pid !== undefined || args.port !== undefined) {
                const adapter = selectAttachAdapter(commandCwd, args.adapter, args.port);
                if (adapter) {
                  return t("format.selected_adapter_attach",
                    adapter.name,
                    adapter.languages.length > 0
                      ? t("format.languages", adapter.languages.join(", "))
                      : "",
                  );
                }
                return t("format.no_adapter_found_attach", getConfiguredAdapters(commandCwd));
              }
              const available = getAvailableAdapters(commandCwd);
              if (available.length === 0) return t("format.no_adapters_available");
              return t("format.available_adapters",
                available.map(a =>
                  `- ${a.name}${a.languages.length > 0 ? ` (${a.languages.join(", ")})` : ""}`
                ).join("\n"),
              );
            }

            case "configureLaunch": {
              const commandCwd = args.cwd ? path.resolve(args.cwd) : ctx.directory;
              if (!args.program) {
                throw new Error(t("error.configure_launch_requires_program"));
              }
              const program = path.resolve(commandCwd, args.program);
              const programKind = await classifyLaunchProgram(program);
              const selection = selectLaunchAdapter(program, commandCwd, args.adapter, programKind);
              if (selection.kind !== "adapter") {
                throw new Error(t("error.no_adapter_for_program"));
              }
              const adapter = selection.adapter;
              validateLaunchProgram(program, commandCwd, programKind, adapter);
              const extraLaunchArguments = resolveLaunchOverrides(adapter, program, programKind);
              const launchConfig = {
                ...adapter.launchDefaults,
                ...extraLaunchArguments,
                program,
                cwd: commandCwd,
                ...(args.args !== undefined ? { args: args.args } : {}),
} satisfies z.ZodRawShape;
              const lines = [
                t("format.configure_launch_adapter", adapter.name),
                t("format.configure_launch_command", adapter.resolvedCommand),
                t("format.configure_launch_program", program),
                t("format.configure_launch_cwd", commandCwd),
                t("format.configure_launch_config", JSON.stringify(launchConfig, null, 2)),
              ];
              return lines.join("\n");
            }

            case "setBreakpoint": {
              if (args.function) {
                const response = await dapSessionManager.setFunctionBreakpoint(
                  args.function,
                  args.condition,
                  ctx.abort,
                  timeoutSec * 1000,
                );
                return format.formatSetFunctionBreakpoint(response.breakpoints);
              }
              if (!args.file || args.line === undefined) {
                throw new Error(t("error.breakpoint_requires_file_or_func"));
              }
              const file = path.resolve(args.cwd ?? ctx.directory, args.file);
              const response = await dapSessionManager.setBreakpoint(
                file,
                args.line,
                args.condition,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSetBreakpoint(response.sourcePath, response.breakpoints);
            }

            case "removeBreakpoint": {
              if (args.function) {
                const response = await dapSessionManager.removeFunctionBreakpoint(
                  args.function,
                  ctx.abort,
                  timeoutSec * 1000,
                );
                return format.formatSetFunctionBreakpoint(response.breakpoints);
              }
              if (!args.file || args.line === undefined) {
                throw new Error(t("error.remove_breakpoint_requires_file_or_func"));
              }
              const file = path.resolve(args.cwd ?? ctx.directory, args.file);
              const response = await dapSessionManager.removeBreakpoint(
                file,
                args.line,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSetBreakpoint(response.sourcePath, response.breakpoints);
            }

            case "setFunctionBreakpoint": {
              if (!args.function) {
                throw new Error(t("error.func_breakpoint_requires_func"));
              }
              const response = await dapSessionManager.setFunctionBreakpoint(
                args.function,
                args.condition,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSetFunctionBreakpoint(response.breakpoints);
            }

            case "removeFunctionBreakpoint": {
              if (!args.function) {
                throw new Error(t("error.remove_func_breakpoint_requires_func"));
              }
              const response = await dapSessionManager.removeFunctionBreakpoint(
                args.function,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSetFunctionBreakpoint(response.breakpoints);
            }

            case "setInstructionBreakpoint": {
              if (!args.instructionReference) {
                throw new Error(t("error.inst_breakpoint_requires_ref"));
              }
              const response = await dapSessionManager.setInstructionBreakpoint(
                args.instructionReference,
                args.offset,
                args.condition,
                args.hitCondition,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSetInstructionBreakpoint(response.breakpoints);
            }

            case "removeInstructionBreakpoint": {
              if (!args.instructionReference) {
                throw new Error(t("error.remove_inst_breakpoint_requires_ref"));
              }
              const response = await dapSessionManager.removeInstructionBreakpoint(
                args.instructionReference,
                args.offset,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSetInstructionBreakpoint(response.breakpoints);
            }

            case "setDataBreakpoint": {
              if (!args.dataId) {
                throw new Error(t("error.data_breakpoint_requires_dataid"));
              }
              const response = await dapSessionManager.setDataBreakpoint(
                args.dataId,
                args.accessType,
                args.condition,
                args.hitCondition,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSetDataBreakpoint(response.breakpoints);
            }

            case "removeDataBreakpoint": {
              if (!args.dataId) {
                throw new Error(t("error.remove_data_breakpoint_requires_dataid"));
              }
              const response = await dapSessionManager.removeDataBreakpoint(
                args.dataId,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatSetDataBreakpoint(response.breakpoints);
            }

            case "continue": {
              const outcome: DapContinueOutcome = await dapSessionManager.continue(ctx.abort, timeoutSec * 1000);
              return format.buildOutcomeText(outcome.snapshot, outcome.state, outcome.timedOut, timeoutSec, "Continue");
            }

            case "pause": {
              const snapshot = await dapSessionManager.pause(ctx.abort, timeoutSec * 1000);
              return format.formatPause(snapshot);
            }

            case "stepOver": {
              const outcome = await dapSessionManager.stepOver(ctx.abort, timeoutSec * 1000);
              return format.buildOutcomeText(outcome.snapshot, outcome.state, outcome.timedOut, timeoutSec, "Step over");
            }

            case "stepIn": {
              const outcome = await dapSessionManager.stepIn(ctx.abort, timeoutSec * 1000);
              return format.buildOutcomeText(outcome.snapshot, outcome.state, outcome.timedOut, timeoutSec, "Step in");
            }

            case "stepOut": {
              const outcome = await dapSessionManager.stepOut(ctx.abort, timeoutSec * 1000);
              return format.buildOutcomeText(outcome.snapshot, outcome.state, outcome.timedOut, timeoutSec, "Step out");
            }

            case "evaluate": {
              if (!args.expression) {
                throw new Error(t("error.evaluate_requires_expression"));
              }
              const evaluationContext = args.context ?? "repl";
              const response = await dapSessionManager.evaluate(
                args.expression,
                evaluationContext,
                args.frameId,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatEvaluate(response.evaluation);
            }

            case "stackTrace": {
              const response = await dapSessionManager.stackTrace(args.levels, ctx.abort, timeoutSec * 1000);
              return format.formatStackFrames(response.stackFrames);
            }

            case "threads": {
              const response = await dapSessionManager.threads(ctx.abort, timeoutSec * 1000);
              return format.formatThreads(response.threads);
            }

            case "scopes": {
              const response = await dapSessionManager.scopes(args.frameId, ctx.abort, timeoutSec * 1000);
              return format.formatScopes(response.scopes);
            }

            case "variables": {
              const variableReference = args.variableRef ?? args.scopeId;
              if (variableReference === undefined) {
                throw new Error(t("error.variables_requires_ref"));
              }
              const response = await dapSessionManager.variables(variableReference, ctx.abort, timeoutSec * 1000);
              return format.formatVariables(response.variables);
            }

            case "disassemble": {
              if (args.instructionCount === undefined) {
                throw new Error(t("error.disassemble_requires_count"));
              }
              let memoryRef = args.memoryReference;
              if (!memoryRef) {
                const snapshot = getActiveSessionSnapshot();
                if (snapshot.instructionPointerReference) {
                  memoryRef = snapshot.instructionPointerReference;
                } else {
                  throw new Error(t("error.disassemble_requires_memref"));
                }
              }
              const response = await dapSessionManager.disassemble(
                memoryRef,
                args.instructionCount,
                args.offset,
                args.instructionOffset,
                args.resolveSymbols,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatDisassemble(response.instructions);
            }

            case "readMemory": {
              if (!args.memoryReference) {
                throw new Error(t("error.read_memory_requires_memref"));
              }
              if (args.count === undefined) {
                throw new Error(t("error.read_memory_requires_count"));
              }
              const response = await dapSessionManager.readMemory(
                args.memoryReference,
                args.count,
                args.offset,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatReadMemory(response.address, response.data, response.unreadableBytes);
            }

            case "loadedSources": {
              const response = await dapSessionManager.loadedSources(ctx.abort, timeoutSec * 1000);
              return format.formatLoadedSources(response.sources);
            }

            case "modules": {
              const response = await dapSessionManager.modules(
                args.startModule,
                args.moduleCount,
                ctx.abort,
                timeoutSec * 1000,
              );
              return format.formatModules(response.modules);
            }


            case "output": {
              const response = dapSessionManager.getOutput();
              return format.formatOutput(response.output);
            }

            case "sessions": {
              const sessions = dapSessionManager.listSessions();
              return format.formatSessions(sessions);
            }

            default: {
              const _exhaustive: never = args.action;
              throw new Error(t("error.unsupported_action", String(args.action)));
            }
          }
        },
      }),
    },
  };
}
