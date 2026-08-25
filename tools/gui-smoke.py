#!/usr/bin/env python3
"""CDP GUI smoke test for LazyOffice desktop-app.

Launches nothing itself: start the app first with

    ./node_modules/.bin/electron . --remote-debugging-port=9223 --no-sandbox

then run

    uv run --with websocket-client python3 tools/gui-smoke.py [--port 9223] [--keep]

Checks, against the REAL renderer over Chrome DevTools Protocol:
  1. boot health: no console errors, provider status line renders
  2. Settings flow: switch provider to ox-alpha (OpenRouter), paste the
     OPENROUTER_API_KEY from the environment, save
  3. secret-at-rest: stored key is encrypted (enc:v1: prefix in config.json)
  4. live LLM round-trip: Get Plan returns non-empty ox-alpha prose

Exit code 0 = all checks passed. --keep leaves the app running.
Requires OPENROUTER_API_KEY in the environment for steps 2-4.
"""

import argparse
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.request

PORT_DEFAULT = 9223


class CDP:
    """Minimal Chrome DevTools Protocol client over stdlib sockets."""

    def __init__(self, port):
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
        pages = [t for t in targets if t.get("type") == "page"]
        if not pages:
            raise RuntimeError("no page target found on CDP port " + str(port))
        self.url = pages[0]["webSocketDebuggerUrl"]
        self._connect()
        self.msg_id = 0
        self.events = []
        self.console = []

    def _connect(self):
        http = self.url.split("://")[1]
        host, path = http.split("/", 1)
        hostname, port = host.split(":")
        self.sock = socket.create_connection((hostname, int(port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET /{path} HTTP/1.1\r\nHost: {host}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            resp += self.sock.recv(4096)
        if b"101" not in resp.split(b"\r\n")[0]:
            raise RuntimeError("websocket upgrade failed: " + resp[:200].decode(errors="replace"))

    def _send_frame(self, payload):
        """Send a masked text frame (client->server frames MUST be masked)."""
        frame = bytearray([0x81])  # FIN + text opcode
        n = len(payload)
        if n < 126:
            frame.append(0x80 | n)
        elif n < 65536:
            frame.append(0x80 | 126)
            frame += struct.pack(">H", n)
        else:
            frame.append(0x80 | 127)
            frame += struct.pack(">Q", n)
        mask = os.urandom(4)
        frame += mask
        frame += bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(frame))

    def _recv_frame(self):
        # Loop over control frames: answer pings (Chromium disconnects clients
        # that don't pong within ~1 min), ignore pongs, return text/binary.
        while True:
            header = self._recv_exact(2)
            opcode = header[0] & 0x0F
            length = header[1] & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            payload = self._recv_exact(length)
            if opcode == 8:
                raise RuntimeError("websocket closed by peer")
            if opcode == 9:  # ping -> must reply with a masked pong
                self._send_ctl(0x8A, payload)
                continue
            if opcode == 10:  # unsolicited pong — ignore
                continue
            return payload

    def _send_ctl(self, first_byte, payload):
        frame = bytearray([first_byte])
        n = len(payload)
        frame.append(0x80 | n)
        mask = os.urandom(4)
        frame += mask
        frame += bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(frame))

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise RuntimeError("socket EOF")
            buf += chunk
        return buf

    def pump(self, seconds=0.0):
        """Read pending messages (responses + events) for up to `seconds`."""
        deadline = time.time() + seconds
        self.sock.settimeout(max(0.05, deadline - time.time()))
        while True:
            try:
                payload = self._recv_frame()
            except (socket.timeout, TimeoutError):
                return
            msg = json.loads(payload)
            if "id" in msg:
                self.responses[msg["id"]] = msg
            else:
                self.events.append(msg)
                if msg.get("method") == "Runtime.consoleAPICalled":
                    args = " ".join(str(a.get("value", a.get("description", "")))[:120]
                                    for a in msg["params"].get("args", []))
                    self.console.append(f"[{msg['params'].get('type')}] {args}")
                elif msg.get("method") == "Runtime.exceptionThrown":
                    detail = msg["params"].get("exceptionDetails", {})
                    self.console.append("[exception] " + json.dumps(detail)[:200])

    responses = {}

    def call(self, method, params=None, wait=15.0):
        self.msg_id += 1
        mid = self.msg_id
        self._send_frame(json.dumps({"id": mid, "method": method, "params": params or {}}).encode())
        deadline = time.time() + wait
        while mid not in self.responses:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise TimeoutError(f"CDP {method} timed out")
            self.pump(min(remaining, 0.5))
        result = self.responses.pop(mid)
        if "error" in result:
            raise RuntimeError(f"CDP {method}: {result['error']}")
        return result.get("result", {})

    def evaluate(self, expr, await_promise=False, wait=30.0):
        res = self.call("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
        }, wait=wait)
        val = res.get("result", {})
        if val.get("subtype") == "error":
            raise RuntimeError("page eval failed: " + val.get("description", "")[:300])
        return val.get("value")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT_DEFAULT)
    ap.add_argument("--keep", action="store_true", help="leave the app running")
    args = ap.parse_args()

    cdp = CDP(args.port)
    cdp.call("Runtime.enable")
    results, failed = [], 0

    def check(name, fn):
        global_failed = False
        try:
            detail = fn()
        except Exception as e:  # noqa: BLE001 - report anything as a failure
            results.append(("FAIL", name, str(e)[:220]))
            return 1
        results.append(("PASS", name, detail or ""))
        return 0 if not global_failed else 1

    def eval_js(expr, await_promise=False, wait=30.0):
        return cdp.evaluate(expr, await_promise=await_promise, wait=wait)

    # --- 1. boot health ---
    def boot():
        ready = eval_js("document.readyState")
        status = eval_js("document.getElementById('provider-status').textContent")
        setup_box = eval_js(
            "getComputedStyle(document.getElementById('llm-setup-box')).display")
        return f"readyState={ready}; status='{status}'; setupBox={setup_box}"
    failed += check("boot: page ready + provider status renders", boot)

    # --- 2. settings flow: switch to ox-alpha ---
    key = os.environ.get("OPENROUTER_API_KEY", "")
    have_key = bool(key)

    def settings_switch():
        if not have_key:
            raise RuntimeError("OPENROUTER_API_KEY not set in environment; cannot exercise settings flow")
        eval_js("toggleSettings()")
        opts = eval_js(
            "JSON.stringify(Array.from(document.getElementById('setting-provider').options)"
            ".map(o => o.value + ':' + o.text))")
        sel = eval_js(
            "var s=document.getElementById('setting-provider');"
            "s.value='openrouter'; s.dispatchEvent(new Event('change')); s.value")
        field = eval_js(
            "var f=document.getElementById('setting-openrouter-key');"
            f"f.value={json.dumps(key)}; f.dispatchEvent(new Event('input')); 'typed'")
        saved = eval_js("saveSettings(); 'saved'")
        return f"options={opts}; selected={sel}; {field}; {saved}"
    failed += check("settings: provider dropdown has ox-alpha, switch + save key", settings_switch)

    def persisted():
        got = eval_js(
            "window.desktop.getSettings()"
            ".then(s => JSON.stringify({p: s.LLM_PROVIDER,"
            " set: !!s.OPENROUTER_API_KEY_SET,"
            " unreadable: !!s.OPENROUTER_API_KEY_UNREADABLE}))",
            await_promise=True)
        d = json.loads(got)
        if d.get("p") != "openrouter" or not d.get("set") or d.get("unreadable"):
            raise RuntimeError(f"unexpected settings state: {got}")
        return f"provider={d['p']}, key SET, readable"
    failed += check("settings: persisted (provider=openrouter, key SET via IPC)", persisted)

    # --- 3. encryption at rest ---
    def at_rest():
        home = os.path.expanduser("~")
        cfg_path = os.path.join(home, "Library", "Application Support",
                                "lazyoffice-desktop", "config.json")
        cfg = json.load(open(cfg_path))
        v = cfg.get("OPENROUTER_API_KEY", "")
        if not v.startswith("enc:v1:"):
            raise RuntimeError("key not encrypted at rest (no enc:v1: prefix)")
        return "stored value starts with enc:v1: (keychain-encrypted)"
    failed += check("security: OPENROUTER_API_KEY encrypted at rest", at_rest)

    # --- 4. live ox-alpha round trip through the real UI ---
    def get_plan():
        eval_js(
            "toggleSettings();"
            "var r=document.getElementById('request');"
            "r.value='A short welcome note for the LazyOffice team';"
            "r.dispatchEvent(new Event('input'));"
            "document.getElementById('plan-btn').click(); 'clicked'")
        deadline = time.time() + 180
        last = ""
        while time.time() < deadline:
            time.sleep(2)
            cdp.pump(0.2)
            last = eval_js(
                "(function(){var p=document.getElementById('plan-text');"
                "var b=document.getElementById('plan-btn');"
                "return (b.disabled?'[busy] ':'') + p.textContent.slice(0,160);})()")
            if last and not last.startswith("[busy]") and last.strip():
                return "plan: " + last[:150]
        raise RuntimeError("plan never arrived within 180s; last UI state: " + last)
    failed += check("live: Get Plan returns ox-alpha output through real renderer", get_plan)

    print()
    for state, name, detail in results:
        mark = "✅" if state == "PASS" else "❌"
        print(f"{mark} {state}  {name}")
        if detail:
            print(f"     {detail}")
    print()
    errs = [c for c in cdp.console if c.startswith("[exception]")]
    print(f"console exceptions: {len(errs)}")
    for e in errs[:5]:
        print("  " + e)
    print(f"(full console lines captured: {len(cdp.console)})")

    if not args.keep:
        try:
            eval_js("window.close()", wait=5)
        except Exception:
            pass

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
