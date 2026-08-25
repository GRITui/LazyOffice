#!/usr/bin/env python3
"""CDP end-to-end generation test for LazyOffice desktop-app.

Drives the REAL renderer through the full HITL flow for each output type:
  request -> select type -> Get Plan (live ox-alpha) -> Approve & Generate ->
  verify the file exists on disk and its OOXML content is real.

Start the app first:
    ./node_modules/.bin/electron . --remote-debugging-port=9223 --no-sandbox

Then:
    OPENROUTER_API_KEY=... uv run --with websocket-client python3 tools/e2e-generate.py

Requires the app to already have a working provider configured (the GUI smoke
test sets ox-alpha up). Verifies file bytes, not just existence: docx must
contain real paragraphs, xlsx real rows, pptx real slides with text.
"""

import argparse
import importlib.util
import json
import os
import re
import sys
import time
import zipfile

# gui-smoke.py has a hyphen, so it needs importlib rather than a plain import.
_spec = importlib.util.spec_from_file_location(
    "gui_smoke", os.path.join(os.path.dirname(os.path.abspath(__file__)), "gui-smoke.py"))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
CDP = _mod.CDP

HOME = os.path.expanduser("~")
OUTPUT_DIR = os.path.join(HOME, "Documents", "LazyOffice")

PROMPTS = {
    "document": "A half-page note explaining why regular car oil changes matter",
    "spreadsheet": "A tiny fuel log with three rows: Jan 120km 8.5L, Feb 132km 9.1L, Mar 118km 8.2L",
    "presentation": "Three slides about staying alert on long night drives",
}


def latest_file(ext, since_ts):
    """Newest file of `ext` in OUTPUT_DIR created after since_ts."""
    best = None
    for name in os.listdir(OUTPUT_DIR):
        if not name.endswith("." + ext):
            continue
        path = os.path.join(OUTPUT_DIR, name)
        if os.path.getmtime(path) < since_ts - 2:  # 2s clock skew tolerance
            continue
        if best is None or os.path.getmtime(path) > os.path.getmtime(best):
            best = path
    return best


def ooxml_texts(path):
    """All text content in an OOXML file. docx/pptx use <w:t>/<a:t> runs;
    SheetJS xlsx puts cell strings in <c t="str"><v>...</v></c> (and shared
    strings in sharedStrings.xml), so extract both shapes."""
    texts = []
    patterns = [
        r"<(?:a|w):?t[^>]*>([^<]+)</(?:a|w):?t>",
        r"<t[^>]*>([^<]+)</t>",
        r'<c[^>]*t="str"[^>]*>\s*<v>([^<]+)</v>',
        r"<v>([^<]+)</v>",  # last resort: any cached value
    ]
    with zipfile.ZipFile(path) as z:
        entries = [e for e in z.namelist() if re.match(
            r"(word/document|ppt/slides/slide\d+|xl/sharedStrings|xl/worksheets/sheet\d+)\.xml$", e)]
        for entry in entries:
            xml = z.read(entry).decode("utf-8", errors="replace")
            found = []
            for pat in patterns:
                found = re.findall(pat, xml)
                if found:
                    break
            texts.extend(t.strip() for t in found)
    return [t for t in texts if t]


def wait_for_result(cdp, deadline_s, ext):
    """Poll the renderer until the result card shows a path with our ext."""
    deadline = time.time() + deadline_s
    last_status = ""
    while time.time() < deadline:
        time.sleep(2)
        cdp.pump(0.2)
        state = cdp.evaluate(
            "(function(){var p=document.getElementById('doc-path');"
            "var b=document.getElementById('approve-btn');"
            "var r=document.getElementById('result-box');"
            "return JSON.stringify({path:p?p.textContent:'',busy:b?b.disabled:false,"
            "result:r?r.style.display==='block':false,"
            "status:(document.querySelector('.status')||{}).textContent||''});})()")
        d = json.loads(state)
        last_status = d.get("status", "")
        if d["path"].endswith("." + ext) and not d["busy"]:
            return d["path"], None
        if "Error" in last_status:
            return None, last_status
    return None, "timed out after %ss; last status: %s" % (deadline_s, last_status)


def run_flow(cdp, out_type, prompt):
    started = time.time()
    eval_js = lambda expr: cdp.evaluate(expr)
    eval_js(
        f"selectOutputType('{out_type}');"
        f"var r=document.getElementById('request');"
        f"r.value={json.dumps(prompt)};"
        "r.dispatchEvent(new Event('input'));"
        "document.getElementById('plan-btn').click(); 'plan-requested'")
    # Wait for plan to render, then approve.
    deadline = time.time() + 180
    while time.time() < deadline:
        time.sleep(2)
        cdp.pump(0.2)
        busy = eval_js(
            "(document.getElementById('plan-btn')||{}).disabled===true")
        plan = eval_js("(document.getElementById('plan-text')||{textContent:''}).textContent")
        if not busy and plan.strip():
            break
    else:
        raise RuntimeError(f"{out_type}: plan never arrived in 180s")
    approve_visible = eval_js(
        "(function(){var b=document.getElementById('approve-btn');"
        "return b && b.offsetParent !== null;})()")
    if not approve_visible:
        raise RuntimeError(f"{out_type}: approve button not visible after plan")
    eval_js("document.getElementById('approve-btn').click(); 'approved'")
    path, err = wait_for_result(cdp, 240, {"document": "docx", "spreadsheet": "xlsx", "presentation": "pptx"}[out_type])
    if err:
        raise RuntimeError(f"{out_type}: {err}")
    if not path:
        raise RuntimeError(f"{out_type}: no result path shown")
    # File must exist AND predate nothing (created during this flow).
    if not os.path.isfile(path):
        raise RuntimeError(f"{out_type}: reported file does not exist: {path}")
    mtime_ok = os.path.getmtime(path) >= started - 5
    texts = ooxml_texts(path)
    meaningful = [t for t in texts if len(t) > 12]
    if not mtime_ok:
        raise RuntimeError(f"{out_type}: file was not written during this flow")
    if len(texts) < 3 or not meaningful:
        raise RuntimeError(f"{out_type}: file has too little text content ({len(texts)} runs): {texts[:6]}")
    size = os.path.getsize(path)
    return {
        "type": out_type,
        "file": os.path.basename(path),
        "size_kb": round(size / 1024, 1),
        "text_runs": len(texts),
        "sample": meaningful[0][:90],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9223)
    args = ap.parse_args()

    cdp = CDP(args.port)
    cdp.call("Runtime.enable")

    results, failures = [], 0
    for out_type, prompt in PROMPTS.items():
        try:
            info = run_flow(cdp, out_type, prompt)
            results.append(("PASS", out_type, info))
        except Exception as e:  # noqa: BLE001
            results.append(("FAIL", out_type, str(e)[:250]))
            failures += 1

    print("\n═══ E2E GENERATION RESULTS ═══")
    for state, out_type, detail in results:
        mark = "✅" if state == "PASS" else "❌"
        print(f"{mark} {state}  {out_type}")
        print(f"     {detail}")

    errs = [c for c in cdp.console if c.startswith("[exception]")]
    print(f"\nconsole exceptions: {len(errs)}")
    for e in errs[:4]:
        print("  " + e)

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
