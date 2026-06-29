# Test Design

Test plan for verifying the correctness and effectiveness of the opencode-dap plugin
integration with OpenCode. Covers **42 scenarios** across 9 categories.

## Test Matrix

### A. Wire Protocol — DapClient (6 scenarios)

| # | Scenario | Operation | Expected Result |
|---|----------|-----------|-----------------|
| A1 | Content-Length framing | Send `initialize` request | Response matched by `request_seq` |
| A2 | Partial reads | Split a message across multiple `ReadableStream` chunks | Message reassembled correctly |
| A3 | Multiple messages in one chunk | Two complete messages in a single read | Both dispatched independently |
| A4 | Stderr capture | Adapter writes to stderr during session | Stderr buffered and accessible via `getStderr()` |
| A5 | Event subscription | Register handler for `stopped` event before sending `launch` | Handler fires when `stopped` emitted |
| A6 | Reverse request handling | Register `onReverseRequest`, adapter sends `runInTerminal` | Reverse request dispatched to handler |

### B. Adapter Resolution — config.ts (6 scenarios)

| # | Scenario | Operation | Expected Result |
|---|----------|-----------|-----------------|
| B1 | Python file detection | `selectLaunchAdapter("app.py", cwd)` | Returns `debugpy` adapter |
| B2 | Go file detection | `selectLaunchAdapter("main.go", cwd)` | Returns `dlv` adapter |
| B3 | TypeScript detection | `selectLaunchAdapter("index.ts", cwd)` | Returns `js-debug-adapter` |
| B4 | C file detection | `selectLaunchAdapter("main.c", cwd)` | Returns `lldb-dap` or `gdb` |
| B5 | Project root markers | Cargo.toml → Rust, go.mod → Go, package.json → Node | Correct adapter by marker, not just extension |
| B6 | Missing adapter graceful error | Adapter not in `$PATH` | `getAvailableAdapters()` excludes it, launch gives actionable error |

### C. Session Lifecycle (6 scenarios)

| # | Scenario | Operation | Expected Result |
|---|----------|-----------|-----------------|
| C1 | Launch session | `launch({ adapter, program, cwd })` | Returns `DapSessionSummary` with `status: "running"` |
| C2 | Attach session | `attach({ adapter, cwd, pid })` | Session created, connected to process |
| C3 | Terminate session | `terminate()` | Adapter process killed, `status: "terminated"` |
| C4 | Auto-cleanup on idle | Fire `session.idle` event | `terminate()` called automatically |
| C5 | Auto-cleanup on deleted | Fire `session.deleted` event | `terminate()` called automatically |
| C6 | Multiple session tracking | Launch → terminate → launch again | `listSessions()` shows session history |

### D. Breakpoint Management (6 scenarios)

| # | Scenario | Operation | Expected Result |
|---|----------|-----------|-----------------|
| D1 | Set file breakpoint | `setBreakpoint("main.py", 10)` | Breakpoint verified, counted in summary |
| D2 | Remove breakpoint | `setBreakpoint` then `removeBreakpoint` | Count decremented, `breakpointFiles` updated |
| D3 | Conditional breakpoint | `setBreakpoint("app.py", 5, "x > 10")` | Condition stored, sent to adapter |
| D4 | Function breakpoint | `setFunctionBreakpoint("main")` | Function bp verified |
| D5 | Concurrent breakpoint safety | Two parallel `setBreakpoint` calls | Serialized — no silent overwrites |
| D6 | Breakpoint on nonexistent file | `setBreakpoint("ghost.py", 1)` | Adapter reports unverified, message surfaced |

### E. Execution Control (5 scenarios)

| # | Scenario | Operation | Expected Result |
|---|----------|-----------|-----------------|
| E1 | Continue to breakpoint | `continue()` after launch with bp set | Returns `state: "stopped"`, `stopReason: "breakpoint"` |
| E2 | Step over | `stepOver()` at a breakpoint | Advances to next line in same function |
| E3 | Step in | `stepIn()` at a function call | Enters called function |
| E4 | Step out | `stepOut()` inside a function | Returns to caller |
| E5 | Pause | `pause()` during running state | Program interrupted, `state: "stopped"` |

### F. State Inspection (5 scenarios)

| # | Scenario | Operation | Expected Result |
|---|----------|-----------|-----------------|
| F1 | Stack trace | `stackTrace()` at breakpoint | Returns ordered frame list with file:line |
| F2 | Local variables | `scopes()` → `variables(localsRef)` | Variable names, values, types returned |
| F3 | Evaluate expression | `evaluate("x + y", "repl")` | Expression result with type annotation |
| F4 | Thread listing | `threads()` | All thread IDs and names listed |
| F5 | Output capture | `getOutput()` after print statements | stdout/stderr buffered and accessible |

### G. Error Handling & Edge Cases (5 scenarios)

| # | Scenario | Operation | Expected Result |
|---|----------|-----------|-----------------|
| G1 | Missing program | `launch` with nonexistent path | `ENOENT` error with program path |
| G2 | No adapter available | `launch` with no installed adapter | Actionable error listing installed adapters |
| G3 | Request timeout | Adapter hangs on a request | `AbortError` after timeout, session cleaned |
| G4 | Adapter crash mid-session | Adapter process killed externally | Session status updated, graceful error surface |
| G5 | debugpy missing module | `launch` with debugpy not installed | Error suggests `pip install debugpy` |

### H. Memory & Advanced Features (4 scenarios)

| # | Scenario | Operation | Expected Result |
|---|----------|-----------|-----------------|
| H1 | Read memory | `readMemory(ref, 16)` at breakpoint | Hex/Base64-encoded bytes returned |
| H2 | Write memory | `writeMemory(ref, data)` | Bytes written, count returned |
| H3 | Disassemble | `disassemble(ref, 10)` | Instruction listing with addresses |
| H4 | Capability check | Request unsupported feature (e.g., disassemble on debugpy) | Clear error: "adapter does not support ..." |

### I. Benchmark — With DAP vs Without DAP (8 scenarios)

| # | Debug Scenario | Without DAP (baseline) | With DAP | Key Metric |
|---|---------------|----------------------|-----------|------------|
| I1 | Null pointer crash | Read error output → guess → read source (~3 files) → guess fix → edit → retry (3+ rounds) | Launch → set bp → continue → inspect vars → fix (1 round) | **Iteration count** |
| I2 | Logic bug (wrong condition) | Read logs → read code → trace manually → guess → edit → run → check (3-5 rounds) | Launch → set bp at condition → step over → evaluate expression → confirm → fix (1 round) | **Tool calls to diagnosis** |
| I3 | Deep call stack crash | Read traceback → read each file in stack → guess caller state | Launch → stack_trace → variables at each frame → pinpoint (1 round) | **Files read** |
| I4 | Async/thread race | Symptoms only → trial-and-error sleep/retry edits → 5+ iterations | Launch → threads → pause at suspicious point → inspect all threads | **Attempts needed** |
| I5 | Memory corruption | No direct visibility → printf debugging with many cycles | Launch → set bp → read_memory → disassemble → exact bytes | **Debug cycles** |
| I6 | Performance loop count | Read code → estimate → potentially wrong | Launch → set bp in loop → continue with count → exact count | **Precision** |
| I7 | Multi-file cross-reference | Read 5+ files → infer relationships → guess | Launch → step_into across files → trace actual call chain | **Context accuracy** |
| I8 | Infinite loop / hang | Read code → guess → may misidentify root cause | Launch → pause after hang → stack_trace → exact location | **Diagnostic certainty** |

## Test File Mapping

| Test File | Scenarios | Focus |
|-----------|-----------|-------|
| `tests/dap-config.test.ts` | B6, G2 | Adapter resolution, error messages |
| `tests/dap-launch-failures.test.ts` | C1, C2, G1-G5 | Launch/attach lifecycle, error handling |
| `tests/dap-write-sink-flush.typecheck.ts` | — | Type-level assertion |
| `tests/dap-client.test.ts` (new) | A1-A6 | Wire protocol framing, event dispatch |
| `tests/dap-session.test.ts` (new) | C3-C6, D1-D6 | Session lifecycle, breakpoint serialization |
| `tests/dap-execution.test.ts` (new) | E1-E5, F1-F5 | Step control, state inspection |
| `tests/dap-comparison.test.ts` (new) | I1-I8 | With vs without DAP benchmarks |
