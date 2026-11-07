## Running commands on this machine (OpenCode: `bash` tool = Git Bash on Windows)

- Your `bash` tool runs **bash**, even on Windows: use bash syntax (`ls`, `cat`, `tail -n 20`, `sleep 5`,
  `VAR=1 cmd`, `&&`). PowerShell cmdlets do not exist there. Paths: `/d/Projects/x` or `D:/Projects/x`.
- Python as modules: `python -m pytest`, `python -m http.server 8000`. Node tools via `npx …` / `npm run …`.
- **A bash call blocks until the command exits.** Never run a dev server, watcher or game loop directly
  (`npm run dev`, `vite`, `python -m http.server`) — the call hangs until its timeout.
- **Server + check → `scripts/with_server.mjs`**, never `spawn()` a server inside your own script
  (on Windows `child.kill()` leaves the real server running and your script never exits):
  `node <this skill>/scripts/with_server.mjs --serve "npx vite preview --port 5577 --strictPort" --cwd app
  --port 5577 -- node <this skill>/scripts/ui_probe.mjs --url http://localhost:5577 ...`.
  It waits for the port, runs the command, kills the whole server tree and exits.
- A long build/render: give the bash call a longer `timeout` (ms) instead of backgrounding it.
- If something is left listening on a port: `netstat -ano | grep :5577` → `taskkill //PID <pid> //T //F`.
- The skill's scripts always exist at the paths shown — don't spend calls checking them.
- Code longer than a few lines goes into a file (`.proof/check_x.mjs`, `tests/test_x.py`) and is run with
  `node file` / `python file` — easier to re-run after each fix.
- **Line endings**: many files here are CRLF. If an edit fails to match, re-read the exact lines and retry
  once with the exact text. Never rewrite a whole file just to change line endings, and check `git diff`
  shows only your lines (no whole-file churn).

