#!/usr/bin/env python3
"""测试 java_dap_bridge.py 是否正常启动 JDTLS DAP。"""

import asyncio
import os
import sys
import subprocess

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(PROJECT_DIR)
BRIDGE_SRC = os.path.join(PARENT_DIR, "src", "dap")
sys.path.insert(0, BRIDGE_SRC)

from java_dap_bridge import start_jdtls, init_jdtls, start_debug_session, LspClient  # noqa: E402

DEBUG_PLUGIN_JAR = "/home/lbf/.local/bin/jdtls/com.microsoft.java.debug.plugin-0.53.2.jar"


async def main():
    print("=== 测试 java_dap_bridge.py ===\n")

    print(f"测试目录: {PROJECT_DIR}")
    print(f"JAVA_BIN:  {os.environ.get('JAVA_BIN', '(default)')}")
    print(f"JDTLS_HOME: {os.environ.get('JDTLS_HOME', '(default)')}")
    print(f"DEBUG_PLUGIN_JAR: {DEBUG_PLUGIN_JAR}")
    print()

    # 1. 编译测试用 Java 源文件
    java_file = os.path.join(PROJECT_DIR, "App.java")
    if not os.path.isfile(java_file):
        print(f"错误: 找不到 {java_file}")
        sys.exit(1)

    java_bin = os.environ.get("JAVA_BIN", "java")
    javac_bin = java_bin.replace("/bin/java", "/bin/javac")
    if javac_bin.startswith("javac") and "/" not in javac_bin:
        javac_bin = "javac"

    print(f"[1] 编译 App.java ...")
    result = subprocess.run([javac_bin, java_file], cwd=PROJECT_DIR,
                            capture_output=True, text=True)
    if result.returncode != 0:
        print(f"编译失败:\n{result.stderr}")
        sys.exit(1)
    print("    ✅ 编译成功")

    # 2. 启动精简版 JDTLS (带 DAP)
    print(f"\n[2] 启动 JDTLS (含 debug plugin)...")
    try:
        proc, lsp = await asyncio.wait_for(
            start_jdtls(PROJECT_DIR),
            timeout=30,
        )
    except Exception as e:
        print(f"    ❌ 启动失败: {e}")
        sys.exit(1)
    print("    ✅ JDTLS 进程已启动")

    # 3. 初始化 LSP 握手
    print(f"\n[3] LSP 初始化握手...")
    read_task = asyncio.create_task(lsp.read_loop())
    try:
        try:
            await asyncio.wait_for(init_jdtls(lsp, PROJECT_DIR), timeout=30)
        except asyncio.TimeoutError:
            print("    ❌ 初始化超时")
            proc.terminate()
            sys.exit(1)
        print("    ✅ LSP 初始化完成")
    except Exception as e:
        print(f"    ❌ 初始化失败: {e}")
        proc.terminate()
        sys.exit(1)

    # 4. 启动 DAP 调试会话
    print(f"\n[4] 启动 DAP 调试会话...")
    try:
        port = await asyncio.wait_for(start_debug_session(lsp), timeout=30)
        print(f"    ✅ DAP 端口: {port}")
    except asyncio.TimeoutError:
        print("    ❌ 启动调试会话超时")
        proc.terminate()
        sys.exit(1)

    # 5. 清理
    print(f"\n[5] 清理...")
    read_task.cancel()
    proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except (ProcessLookupError, asyncio.TimeoutError):
        proc.kill()
    print("    ✅ JDTLS 进程已终止")

    print(f"\n=== ✅ 全部测试通过 ===")


if __name__ == "__main__":
    asyncio.run(main())
