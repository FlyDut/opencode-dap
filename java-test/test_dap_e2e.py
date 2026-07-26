#!/usr/bin/env python3
"""端到端 DAP 测试：模拟 opencode debug tool 调用 java-dap-bridge，调试 App.java。"""

import json
import os
import subprocess
import sys
import threading
import time

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.path.expanduser("~/.local/bin/java-dap-bridge.py")


def read_message(proc) -> dict | None:
    """从子进程 stdout 读取一个 DAP JSON 消息（header + body）。"""
    header = b""
    while True:
        line = proc.stdout.readline()
        if not line:
            return None
        header += line
        if line == b"\r\n" or line == b"\n":
            break
    header_str = header.decode(errors="replace")
    content_length = 0
    for line in header_str.splitlines():
        line = line.strip()
        if line.lower().startswith("content-length:"):
            content_length = int(line.split(":", 1)[1].strip())
    if content_length <= 0:
        return None
    body = proc.stdout.read(content_length)
    return json.loads(body)


def send_message(proc, msg: dict) -> None:
    body = json.dumps(msg).encode()
    header = f"Content-Length: {len(body)}\r\n\r\n".encode()
    proc.stdin.write(header + body)
    proc.stdin.flush()


def main():
    seq = [0]

    def next_seq():
        seq[0] += 1
        return seq[0]

    print("=== Java DAP 端到端测试 ===\n")
    print(f"Bridge: {BRIDGE}")
    print(f"Project: {PROJECT_DIR}")

    env = os.environ.copy()
    env.setdefault("JAVA_BIN", "/usr/lib/jvm/java-25-openjdk/bin/java")
    env.setdefault("JDTLS_HOME", os.path.expanduser("~/.local/bin/jdtls"))
    env.setdefault("DEBUG_PLUGIN_JAR",
                   os.path.expanduser("~/.local/bin/jdtls/com.microsoft.java.debug.plugin-0.53.2.jar"))

    proc = subprocess.Popen(
        ["python3", "-u", BRIDGE],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=PROJECT_DIR, env=env,
    )

    # 等待 bridge 完成初始化（读取 stderr 来跟踪进度）
    print("[0] 等待 bridge 启动 JDTLS + DAP (最多 60s)...")
    bridge_ready = threading.Event()

    def watch_stderr():
        for line in iter(proc.stderr.readline, b""):
            text = line.decode(errors="replace").rstrip()
            sys.stderr.write(f"     [bridge] {text}\n")
            sys.stderr.flush()
            if "Debug connection" in text or "started" in text.lower() or "WARNING: Using incubator" in text:
                bridge_ready.set()

    stderr_thread = threading.Thread(target=watch_stderr, daemon=True)
    stderr_thread.start()

    if not bridge_ready.wait(timeout=60):
        print("   ⚠️ bridge 可能尚未完全就绪，继续尝试...")
    time.sleep(3)  # 额外等待

    try:
        # 1. Send initialize
        print("[1] initialize 请求...")
        sid = next_seq()
        send_message(proc, {
            "seq": sid,
            "type": "request",
            "command": "initialize",
            "arguments": {
                "clientID": "opencode-dap-test",
                "adapterID": "java",
                "pathFormat": "path",
                "linesStartAt1": True,
                "columnsStartAt1": True,
                "supportsRunInTerminalRequest": True,
            },
        })
        init_resp = read_message(proc)
        if not init_resp or not init_resp.get("success"):
            print(f"   ❌ 失败: {init_resp}")
            return 1
        print(f"   ✅ 成功: adapter={init_resp.get('body', {}).get('name', '?')}")

        # 2. Send launch
        print("[2] launch 请求...")
        main_class = os.path.join(PROJECT_DIR, "App.java")
        sid = next_seq()
        send_message(proc, {
            "seq": sid,
            "type": "request",
            "command": "launch",
            "arguments": {
                "request": "launch",
                "mainClass": main_class,
                "projectRoot": PROJECT_DIR,
            },
        })

        # 3. Wait for "initialized" event + set breakpoint
        print("[3] 等待 initialized 事件...")
        bps_set = False
        bps_line = 4  # int sum = add(a, b);
        while True:
            msg = read_message(proc)
            if msg is None:
                print("   ❌ 未收到消息")
                return 1
            msg_type = msg.get("type", "")
            if msg_type == "event" and msg.get("event") == "initialized":
                print("   ✅ 收到 initialized 事件")
                # Set breakpoint
                print(f"[4] 设置断点 App.java:{bps_line} ...")
                sid = next_seq()
                send_message(proc, {
                    "seq": sid,
                    "type": "request",
                    "command": "setBreakpoints",
                    "arguments": {
                        "source": {"name": "App.java", "path": main_class},
                        "breakpoints": [{"line": bps_line}],
                        "lines": [bps_line],
                    },
                })
                bp_resp = read_message(proc)
                if bp_resp and bp_resp.get("success"):
                    bps = bp_resp.get("body", {}).get("breakpoints", [])
                    verified = any(b.get("verified") for b in bps)
                    print(f"   {'✅' if verified else '⚠️'} 断点: {bps}")
                else:
                    print(f"   ⚠️ 断点设置失败: {bp_resp}")
                bps_set = True
                # Send configurationDone
                print("[5] configurationDone ...")
                sid = next_seq()
                send_message(proc, {
                    "seq": sid,
                    "type": "request",
                    "command": "configurationDone",
                })
                # Wait for stopped event
                print("[6] 等待 stopped 事件...")
                while True:
                    msg = read_message(proc)
                    if msg is None:
                        break
                    if msg.get("type") == "event" and msg.get("event") == "stopped":
                        body = msg.get("body", {})
                        reason = body.get("reason", "?")
                        thread_id = body.get("threadId", "?")
                        print(f"   ✅ 已停止: reason={reason}, threadId={thread_id}")

                        # Get stack trace
                        print("[7] 获取栈帧...")
                        sid = next_seq()
                        send_message(proc, {
                            "seq": sid,
                            "type": "request",
                            "command": "stackTrace",
                            "arguments": {"threadId": thread_id},
                        })
                        st_resp = read_message(proc)
                        if st_resp and st_resp.get("success"):
                            frames = st_resp.get("body", {}).get("stackFrames", [])
                            for f in frames:
                                src = f.get("source", {}).get("name", "?")
                                ln = f.get("line", "?")
                                name = f.get("name", "?")
                                print(f"     {name} at {src}:{ln}")
                        else:
                            print(f"   ⚠️ 栈帧获取失败: {st_resp}")

                        # Evaluate variable
                        print("[8] 求值变量 a ...")
                        fid = frames[0]["id"] if frames else 0
                        sid = next_seq()
                        send_message(proc, {
                            "seq": sid,
                            "type": "request",
                            "command": "evaluate",
                            "arguments": {"expression": "a", "frameId": fid, "context": "repl"},
                        })
                        eval_resp = read_message(proc)
                        if eval_resp and eval_resp.get("success"):
                            result = eval_resp.get("body", {}).get("result", "?")
                            print(f"   ✅ a = {result}")

                            if result == "10":
                                print("\n=== ✅ 全部测试通过 ===")
                            else:
                                print(f"\n=== ⚠️ a 应为 10，实际为 {result} ===")
                        else:
                            print(f"   ❌ 求值失败: {eval_resp}")
                            return 1

                        # Continue
                        print("[9] continue ...")
                        sid = next_seq()
                        send_message(proc, {
                            "seq": sid,
                            "type": "request",
                            "command": "continue",
                            "arguments": {"threadId": thread_id},
                        })
                        break
                break
            elif msg_type == "event" and msg.get("event") == "output":
                category = msg.get("body", {}).get("category", "stdout")
                output = msg.get("body", {}).get("output", "").rstrip()
                if output and category != "telemetry":
                    print(f"     [{category}] {output}")

    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    return 0


if __name__ == "__main__":
    sys.exit(main())
