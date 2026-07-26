#!/usr/bin/env python3
"""JDTLS LSP → DAP TCP bridge for opencode-dap.

启动 JDTLS（如果尚未运行），完成 LSP 握手，
通过 vscode.java.startDebugSession 获取 DAP 端口，
然后桥接 stdin/stdout 与 DAP TCP 连接。
"""

import asyncio
import json
import os
import hashlib
import signal
import sys
from pathlib import Path
import platform
import re
import subprocess

DAP_HOST = os.environ.get("DAP_HOST", "127.0.0.1")
DAP_CONNECT_TIMEOUT = float(os.environ.get("DAP_CONNECT_TIMEOUT", "30"))
LSP_INIT_TIMEOUT = float(os.environ.get("LSP_INIT_TIMEOUT", "60"))


class LspClient:
    """轻量级 LSP JSON-RPC 客户端，通过 subprocess stdin/stdout 通信。"""

    def __init__(self, proc: asyncio.subprocess.Process):
        self._proc = proc
        stdin = proc.stdin
        stdout = proc.stdout
        if stdin is None or stdout is None:
            raise RuntimeError("LSP process stdin/stdout must be piped")
        self._stdin: asyncio.StreamWriter = stdin
        self._stdout: asyncio.StreamReader = stdout
        self._buffer = b""
        self._pending: dict[int, asyncio.Future[dict]] = {}
        self._seq = 0

    async def request(self, method: str, params: dict | None = None) -> dict:
        self._seq += 1
        seq = self._seq
        msg = json.dumps({
            "jsonrpc": "2.0",
            "id": seq,
            "method": method,
            "params": params or {},
        })
        frame = f"Content-Length: {len(msg.encode())}\r\n\r\n{msg}"
        self._stdin.write(frame.encode())
        await self._stdin.drain()

        future: asyncio.Future[dict] = asyncio.get_running_loop().create_future()
        self._pending[seq] = future
        return await future

    async def notify(self, method: str, params: dict | None = None) -> None:
        msg = json.dumps({
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
        })
        frame = f"Content-Length: {len(msg.encode())}\r\n\r\n{msg}"
        self._stdin.write(frame.encode())
        await self._stdin.drain()

    async def read_loop(self) -> None:
        """持续从 JDTLS stdout 读取 LSP 消息，解析 JSON-RPC 响应。"""
        while True:
            chunk = await self._stdout.read(4096)
            if not chunk:
                break
            self._buffer += chunk
            await self._parse_messages()

    async def _parse_messages(self) -> None:
        while True:
            header_end = self._buffer.find(b"\r\n\r\n")
            if header_end == -1:
                break
            header = self._buffer[:header_end].decode()
            content_length = 0
            for line in header.split("\r\n"):
                if line.lower().startswith("content-length:"):
                    try:
                        content_length = int(line.split(":", 1)[1].strip())
                    except ValueError:
                        pass
            if content_length <= 0:
                self._buffer = self._buffer[header_end + 4:]
                continue
            body_start = header_end + 4
            if len(self._buffer) < body_start + content_length:
                break
            body = self._buffer[body_start:body_start + content_length]
            self._buffer = self._buffer[body_start + content_length:]
            try:
                msg = json.loads(body)
                if "id" in msg and msg["id"] in self._pending:
                    future = self._pending.pop(msg["id"])
                    if "error" in msg:
                        future.set_exception(
                            RuntimeError(f"LSP error: {msg['error']}")
                        )
                    else:
                        future.set_result(msg.get("result", {}))
            except json.JSONDecodeError:
                pass


async def start_jdtls(project_dir: str) -> tuple[asyncio.subprocess.Process, LspClient]:
    """直接启动精简的 JDTLS LSP 子进程。"""
    jdtls_home = os.environ.get("JDTLS_HOME", os.path.expanduser("~/.local/bin/jdtls"))
    jdtls_home = os.path.expanduser(jdtls_home)
    if not os.path.isdir(jdtls_home):
        raise FileNotFoundError(f"JDTLS_HOME not found: {jdtls_home}")

    java_home = os.environ.get("JAVA_HOME", "")
    java_bin = os.environ.get("JAVA_BIN", os.path.join(java_home, "bin", "java") if java_home else "java")

    plugins_dir = os.path.join(jdtls_home, "plugins")
    launchers = sorted(Path(plugins_dir).glob("org.eclipse.equinox.launcher_*.jar"))
    if not launchers:
        raise FileNotFoundError(f"equinox launcher not found in: {plugins_dir}")
    launcher_jar = str(launchers[-1])

    system = platform.system()
    if system == "Windows":
        config_dir = os.path.join(jdtls_home, "config_win")
    elif system == "Darwin":
        config_dir = os.path.join(jdtls_home, "config_mac")
    else:
        config_dir = os.path.join(jdtls_home, "config_linux")

    try:
        out = subprocess.check_output(
            [java_bin, "-version"], stderr=subprocess.STDOUT, text=True
        )
        match = re.search(r'version "(\d+)', out)
        java_major = int(match.group(1)) if match else 0
    except Exception:
        java_major = 0

    project_hash = hashlib.sha256(project_dir.encode()).hexdigest()
    dap_workspace = os.path.expanduser(f"~/.cache/jdtls-workspace-dap/{project_hash}")
    os.makedirs(dap_workspace, exist_ok=True)

    jvm_args = [
        java_bin,
        "-Declipse.application=org.eclipse.jdt.ls.core.id1",
        "-Dosgi.bundles.defaultStartLevel=4",
        "-Declipse.product=org.eclipse.jdt.ls.core.product",
        "-Dlog.level=WARN",
        "-Dfile.encoding=UTF-8",
        "-Xms256m",
        "-Xmx2g",
        "-XX:+UseZGC",
        "-XX:+DisableExplicitGC",
        "--add-modules=ALL-SYSTEM",
        "--add-opens", "java.base/java.util=ALL-UNNAMED",
        "--add-opens", "java.base/java.lang=ALL-UNNAMED",
        "--add-opens", "java.base/java.nio=ALL-UNNAMED",
        "--add-opens", "java.base/sun.nio.ch=ALL-UNNAMED",
    ]

    if java_major >= 24:
        jvm_args.append("-XX:+UseCompactObjectHeaders")

    if java_major >= 25:
        jvm_args.extend([
            "-XX:+ZUncommit",
            "-XX:ZUncommitDelay=300",
        ])

    jvm_args.extend([
        "-jar", launcher_jar,
        "-configuration", config_dir,
        "-data", dap_workspace,
    ])

    proc = await asyncio.create_subprocess_exec(
        *jvm_args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=project_dir,
    )
    return proc, LspClient(proc)


async def init_jdtls(lsp: LspClient, project_dir: str) -> None:
    """完成 JDTLS LSP 初始化握手。"""
    root_uri = Path(project_dir).resolve().as_uri()

    init_opts = {}
    debug_plugin_jar = os.environ.get("DEBUG_PLUGIN_JAR", "")
    if debug_plugin_jar:
        debug_plugin_jar = os.path.expanduser(os.path.expandvars(debug_plugin_jar))
        if os.path.isfile(debug_plugin_jar):
            init_opts["bundles"] = [debug_plugin_jar]

    await lsp.request("initialize", {
        "processId": os.getpid(),
        "rootUri": root_uri,
        "capabilities": {},
        "initializationOptions": init_opts,
    })
    await lsp.notify("initialized", {})


async def start_debug_session(lsp: LspClient) -> int:
    """请求 JDTLS 启动 DAP 调试会话，返回端口号。"""
    result = await lsp.request(
        "workspace/executeCommand",
        {"command": "vscode.java.startDebugSession"},
    )
    if isinstance(result, int):
        return result
    if isinstance(result, dict) and "port" in result:
        return result["port"]
    if isinstance(result, str) and result.isdigit():
        return int(result)
    raise RuntimeError(
        f"Unexpected startDebugSession response: {result}"
    )


async def bridge_stdio_to_tcp(
    host: str, port: int,
    lsp_proc: asyncio.subprocess.Process | None = None,
) -> None:
    """桥接 stdin/stdout 到 TCP DAP 连接。"""
    loop = asyncio.get_running_loop()

    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(host, port),
        timeout=DAP_CONNECT_TIMEOUT,
    )

    async def stdin_to_tcp() -> None:
        """从 stdin 读取并写入 TCP。"""
        try:
            stdin_reader = asyncio.StreamReader()
            stdin_protocol = asyncio.StreamReaderProtocol(stdin_reader)
            await loop.connect_read_pipe(lambda: stdin_protocol, sys.stdin)

            while True:
                data = await stdin_reader.read(65536)
                if not data:
                    break
                writer.write(data)
                await writer.drain()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            try:
                writer.close()
            except OSError:
                pass

    async def tcp_to_stdout() -> None:
        """从 TCP 读取并写入 stdout。"""
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            try:
                sys.stdout.buffer.flush()
            except OSError:
                pass

    async def monitor_lsp() -> None:
        """监控 LSP 进程退出。"""
        if lsp_proc is not None:
            await lsp_proc.wait()

    done, pending = await asyncio.wait(
        [
            asyncio.create_task(stdin_to_tcp()),
            asyncio.create_task(tcp_to_stdout()),
            asyncio.create_task(monitor_lsp()),
        ],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()


async def main() -> None:
    project_dir = os.getcwd()
    proc, lsp = await start_jdtls(project_dir)

    read_task: asyncio.Task[None] | None = None
    try:
        read_task = asyncio.create_task(lsp.read_loop())

        try:
            await asyncio.wait_for(
                init_jdtls(lsp, project_dir),
                timeout=LSP_INIT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                "JDTLS 初始化超时，请检查 JDTLS 是否正常启动"
            )

        try:
            port = await asyncio.wait_for(
                start_debug_session(lsp),
                timeout=LSP_INIT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                "启动 DAP 调试会话超时，请确认 java-debug 插件已加载"
            )

        await bridge_stdio_to_tcp(DAP_HOST, port, proc)

    finally:
        if read_task is not None:
            try:
                read_task.cancel()
            except Exception:
                pass
        try:
            proc.terminate()
            await asyncio.wait_for(proc.wait(), timeout=5)
        except (ProcessLookupError, asyncio.TimeoutError):
            proc.kill()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
