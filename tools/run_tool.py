"""Run this project's installed CLI tools without changing machine-wide PATH."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def main():
    config = json.loads((ROOT / "toolchains.local.json").read_text(encoding="utf-8"))
    if len(sys.argv) < 2 or sys.argv[1] not in {"node", "npm", "adb", "python", "info"}:
        print("Usage: python tools/run_tool.py {node|npm|adb|python|info} [arguments...]")
        return 2
    selected = sys.argv[1]
    if selected == "info":
        print(json.dumps(config, ensure_ascii=False, indent=2))
        return 0
    command = [config["node"], config["npmCli"]] if selected == "npm" else [config[selected]]
    for executable in command:
        if not Path(executable).is_file():
            raise FileNotFoundError(executable)
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join([str(Path(config["node"]).parent), str(Path(config["adb"]).parent), env.get("PATH", "")])
    result = subprocess.run(command + sys.argv[2:], env=env, cwd=str(ROOT))
    return result.returncode

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
