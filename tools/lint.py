# -*- coding: utf-8 -*-
"""小程序静态自检（本机无微信开发者工具，只能用脚本兜底）

检查项：
 1. 所有 .js 语法（node --check）
 2. 所有 .json 可解析 + app.json 引用的页面文件齐全
 3. WXML 里不能出现方法调用（{{ xxx.yyy(...) }}）
 4. WXML 里 bind/catch 绑定的事件处理函数在对应 .js 中存在
 5. usingComponents 路径存在
 6. 代码里引用的 /assets/ 图片存在
 7. navigateTo/switchTab/redirectTo 的目标页在 app.json 中注册
 8. require 的相对路径存在
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NODE = r"C:\Users\程蒙\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"

errors = []
warns = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


SKIP_DIRS = {"node_modules", ".git"}


def files(pattern):
    out = []
    for p in ROOT.rglob(pattern):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        out.append(p)
    return sorted(out)


# ---------- 1. JS 语法 ----------
js_files = files("*.js")
for p in js_files:
    r = subprocess.run([NODE, "--check", str(p)], capture_output=True, text=True)
    if r.returncode != 0:
        err(f"JS 语法错误 {p.relative_to(ROOT)}: {r.stderr.strip().splitlines()[-1] if r.stderr else ''}")

# ---------- 2. JSON ----------
json_files = files("*.json")
app_json_path = ROOT / "app.json"
try:
    app = json.loads(app_json_path.read_text(encoding="utf-8"))
except Exception as e:
    err(f"app.json 无法解析: {e}")
    app = {"pages": []}

for p in json_files:
    try:
        json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        err(f"JSON 无法解析 {p.relative_to(ROOT)}: {e}")

# app.json 引用的页面必须四件套齐全
pages = app.get("pages", [])
for page in pages:
    base = ROOT / page
    for ext in (".js", ".wxml", ".json", ".wxss"):
        if not base.with_suffix(ext).exists():
            err(f"app.json 声明的页面缺少文件: {page}{ext}")

theme_loc = app.get("themeLocation")
if theme_loc and not (ROOT / theme_loc).exists():
    err(f"themeLocation 指向的文件不存在: {theme_loc}")

# tabBar 的页面必须在 pages 里
for item in (app.get("tabBar", {}) or {}).get("list", []):
    if item.get("pagePath") not in pages:
        err(f"tabBar 页面未在 pages 中注册: {item.get('pagePath')}")

# ---------- 3/4. WXML ----------
METHOD_CALL = re.compile(r"\{\{[^}]*?\.\w+\s*\(")
BIND = re.compile(r'(?:bind|catch)[:a-zA-Z]*\s*=\s*"([^"{}]+)"')

for wxml in files("*.wxml"):
    text = wxml.read_text(encoding="utf-8")

    for m in METHOD_CALL.finditer(text):
        snippet = m.group(0)[:70].replace("\n", " ")
        err(f"WXML 中出现方法调用（小程序不支持）{wxml.relative_to(ROOT)}: {snippet}")

    # 事件处理函数必须存在
    js = wxml.with_suffix(".js")
    if js.exists():
        jsrc = js.read_text(encoding="utf-8")
        for name in set(BIND.findall(text)):
            if name.startswith("{{"):
                continue
            if not re.search(r"(?:^|[\s,{])" + re.escape(name) + r"\s*[(:]", jsrc, re.M):
                err(f"WXML 绑定的事件没有对应实现 {wxml.relative_to(ROOT)} -> {name}")

# ---------- 5. usingComponents ----------
for p in json_files:
    try:
        cfg = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        continue
    for tag, cpath in (cfg.get("usingComponents") or {}).items():
        target = ROOT / cpath.lstrip("/")
        if not target.with_suffix(".js").exists() and not target.with_suffix(".json").exists():
            err(f"组件路径不存在 {p.relative_to(ROOT)} -> {tag}: {cpath}")

# ---------- 6. 图片资源 ----------
ASSET = re.compile(r"['\"](/assets/[A-Za-z0-9_\-/]+\.png)['\"]")
for p in js_files + files("*.wxml") + files("*.wxss"):
    text = p.read_text(encoding="utf-8")
    for m in ASSET.finditer(text):
        if not (ROOT / m.group(1).lstrip("/")).exists():
            err(f"图片不存在 {p.relative_to(ROOT)} -> {m.group(1)}")

# 动态拼接的图标：base + 后缀
ICON_BASE = re.compile(r"['\"](/assets/icons/([a-z\-]+))['\"]\s*\+\s*([a-zA-Z0-9_]+)")
SUFFIX_SETS = {
    "n": ["", "-d"],
    "p": ["-p", "-pd"],
}
for p in js_files:
    text = p.read_text(encoding="utf-8")
    for m in ICON_BASE.finditer(text):
        base, suf_var = m.group(2), m.group(3)
        for suf in SUFFIX_SETS.get(suf_var, [""]):
            f = ROOT / f"assets/icons/{base}{suf}.png"
            if not f.exists():
                err(f"图标缺失 {p.relative_to(ROOT)} -> {base}{suf}.png")

# ---------- 7. 跳转目标 ----------
NAV = re.compile(r"url:\s*['\"](/pages/[a-z\-/]+)['\"]")
for p in js_files:
    text = p.read_text(encoding="utf-8")
    for m in NAV.finditer(text):
        url = m.group(1).lstrip("/")
        if url not in pages:
            err(f"跳转目标未注册 {p.relative_to(ROOT)} -> {url}")

# ---------- 8. require ----------
REQ = re.compile(r"require\(\s*['\"]((?:\.{1,2}/)[^'\"]+)['\"]\s*\)")
for p in js_files:
    text = p.read_text(encoding="utf-8")
    for m in REQ.finditer(text):
        target = (p.parent / m.group(1)).resolve()
        if not target.with_suffix(".js").exists():
            err(f"require 找不到模块 {p.relative_to(ROOT)} -> {m.group(1)}")

# ---------- 9. wx:for 循环变量名（2026-10-08 日历日期不显示的真凶）----------
# 真实踩过的坑：calendar.wxml 写成 wx:for="{{cells}}" 却用 {{cell.day}} —— 循环变量默认叫 item，
# 于是 cell 恒为 undefined，整格内容都不渲染（真机上表现为「日历里没有日期数字」）。
# 这类错误静态检查能抓：若某个 wx:for 没声明 wx:for-item，而正文用到的根标识符
# 在页面 JS 里根本找不到（连注释、字符串里都没有），那基本就是循环变量名写错了。
GLOBALS = {'item', 'index', 'true', 'false', 'null', 'undefined', 'wx', 'getApp',
           'Math', 'Date', 'Number', 'String', 'Boolean', 'JSON'}
FOR_RE = re.compile(r'wx:for="\{\{[^}]+\}\}"([^>]*)>')
ROOT_RE = re.compile(r'\{\{\s*([a-z][A-Za-z0-9_]*)')
FOR_ITEM_RE = re.compile(r'wx:for-item="([^"]+)"')
for p in files("*.wxml"):
    text = p.read_text(encoding="utf-8")
    js = p.with_suffix(".js")
    known = GLOBALS | set(FOR_ITEM_RE.findall(text))
    if js.exists():
        known |= set(re.findall(r"[A-Za-z_$][A-Za-z0-9_$]*",
                                js.read_text(encoding="utf-8", errors="replace")))
    for m in FOR_RE.finditer(text):
        if "wx:for-item" in m.group(0):
            continue
        body = text[m.end():m.end() + 900]
        # 窗口可能正好把一个 {{...}} 截断（会切出半截变量名，造成误报）→ 丢掉未闭合的尾巴
        cut = body.rfind("{{")
        if cut > -1 and body.find("}}", cut) == -1:
            body = body[:cut]
        unknown = sorted(set(ROOT_RE.findall(body)) - known)
        if unknown:
            err(f"wx:for 循环变量名可疑 {p.relative_to(ROOT)}: 正文用到 {unknown}，"
                f"但页面 JS 里找不到这些名字（是不是该加 wx:for-item=\"...\"？）")

# ---------- 汇总 ----------
print("=" * 60)
print(f"扫描：{len(js_files)} 个 JS / {len(json_files)} 个 JSON / "
      f"{len(files('*.wxml'))} 个 WXML / {len(files('*.wxss'))} 个 WXSS")
print("=" * 60)
for w in warns:
    print("  [warn]", w)
if errors:
    print(f"\n发现 {len(errors)} 个问题：")
    for e in errors:
        print("  [ERR ]", e)
    sys.exit(1)
print("\n全部通过 ✅")
