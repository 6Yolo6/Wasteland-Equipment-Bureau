"""Read-only workstation probes; writes only an explicit report inside this workspace."""
import argparse
import ctypes
import datetime as dt
import json
import locale
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import winreg

EXCLUDED = {"node_modules", "bin", "obj", "dist", "target", ".git", ".agents", ".codex"}
ENGINE_WORDS = re.compile(r"cocos|taptap|tapplay|laya|egret", re.I)

def run(args):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        def decode(data):
            for encoding in ("utf-8", locale.getpreferredencoding(False), "gb18030"):
                try:
                    return data.decode(encoding).strip()
                except (UnicodeDecodeError, LookupError):
                    pass
            return data.decode("utf-8", errors="replace").strip()
        return {"command": args, "exit_code": result.returncode, "stdout": decode(result.stdout), "stderr": decode(result.stderr)}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": args, "error": str(error)}

def installed_apps():
    found = []
    keys = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for hive, key_path in keys:
        try:
            with winreg.OpenKey(hive, key_path) as key:
                for i in range(winreg.QueryInfoKey(key)[0]):
                    try:
                        with winreg.OpenKey(key, winreg.EnumKey(key, i)) as app:
                            def value(name):
                                try:
                                    return winreg.QueryValueEx(app, name)[0]
                                except OSError:
                                    return None
                            name = value("DisplayName")
                            if name and re.search(r"cocos|taptap|tapplay|android studio|laya|egret", name, re.I):
                                found.append({"name": name, "version": value("DisplayVersion"), "location": value("InstallLocation")})
                    except OSError:
                        continue
        except OSError:
            continue
    return found

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    workspace = Path(__file__).resolve().parents[1]
    output = (workspace / args.output).resolve()
    if os.path.commonpath([str(workspace), str(output)]) != str(workspace):
        raise SystemExit("Report output must stay inside the workspace")
    if output.exists():
        raise SystemExit("Refusing to overwrite an existing report: " + str(output))
    report = {
        "captured_at": dt.datetime.now().astimezone().isoformat(),
        "workspace": str(workspace),
        "inspection_scope": "Read-only system probes; no installs, configuration edits, device-server startup, or project initialization.",
        "os": {"system": platform.system(), "release": platform.release(), "version": platform.version(), "architecture": platform.machine()},
        "workspace_entries": sorted(p.name for p in workspace.iterdir()),
        "tool_paths": {}, "commands": [], "known_environment": {},
    }
    for name in ("node", "npm", "python", "py", "git", "rg", "CocosCreator", "CocosDashboard", "adb", "java", "javac", "cmake", "ninja", "code"):
        report["tool_paths"][name] = shutil.which(name)
    version_args = {"node": ["--version"], "npm": ["--version"], "python": ["--version"], "py": ["-0p"], "git": ["--version"], "java": ["-version"], "javac": ["-version"], "rg": ["--version"]}
    for name, args2 in version_args.items():
        binary = report["tool_paths"][name]
        if binary:
            report["commands"].append(run([binary] + args2))
    git = report["tool_paths"]["git"]
    if git:
        report["commands"].append(run([git, "-C", str(workspace), "status", "--short", "--branch"]))
        report["commands"].append(run([git, "-C", str(workspace), "rev-parse", "--show-toplevel"]))
    for name in ("JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "COCOS_CREATOR_PATH", "COCOS_DASHBOARD_PATH"):
        report["known_environment"][name] = os.environ.get(name)
    home = Path.home()
    roots = [Path("C:/"), Path("D:/"), Path("C:/Program Files"), Path("C:/Program Files (x86)"), home / "AppData/Local", home / "AppData/Local/Programs", home / "AppData/Roaming", Path("D:/taptap"), home]
    report["engine_scan"] = {"roots": [str(p) for p in roots], "matches": [], "errors": [], "limitation": "Searches standard installation roots, matching top-level directory names and uninstall registry only; portable installations in arbitrary locations may be missed."}
    for base in roots:
        try:
            for child in base.iterdir():
                if child.name not in EXCLUDED and ENGINE_WORDS.search(child.name):
                    report["engine_scan"]["matches"].append({"path": str(child), "directory": child.is_dir()})
        except OSError as error:
            report["engine_scan"]["errors"].append({"path": str(base), "error": str(error)})
    report["installed_apps"] = installed_apps()
    adb_candidates = [Path("D:/AndroidSdk/platform-tools/adb.exe"), home / "AppData/Local/Android/Sdk/platform-tools/adb.exe"]
    for variable in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(variable):
            adb_candidates.append(Path(os.environ[variable]) / "platform-tools/adb.exe")
    report["adb_candidates"] = []
    for candidate in dict.fromkeys(adb_candidates):
        entry = {"path": str(candidate), "exists": candidate.is_file()}
        if entry["exists"]:
            entry["version_probe"] = run([str(candidate), "version"])
        report["adb_candidates"].append(entry)
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        java_exe = Path(java_home) / "bin/java.exe"
        report["java_home_exe"] = {"path": str(java_exe), "exists": java_exe.is_file()}
        if java_exe.is_file():
            report["java_home_exe"]["version_probe"] = run([str(java_exe), "-version"])
    report["disk_gib"] = {}
    for drive in ("C:/", "D:/"):
        usage = shutil.disk_usage(drive)
        report["disk_gib"][drive] = {"total": round(usage.total / 2**30, 2), "free": round(usage.free / 2**30, 2)}
    class Memory(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong), ("available", ctypes.c_ulonglong), ("page_total", ctypes.c_ulonglong), ("page_available", ctypes.c_ulonglong), ("virtual_total", ctypes.c_ulonglong), ("virtual_available", ctypes.c_ulonglong), ("extended", ctypes.c_ulonglong)]
    memory = Memory()
    memory.length = ctypes.sizeof(Memory)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
        report["memory_gib"] = {"total": round(memory.total / 2**30, 2), "available": round(memory.available / 2**30, 2)}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as target:
        json.dump(report, target, ensure_ascii=False, indent=2)
        target.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("Report saved: " + str(output))

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
