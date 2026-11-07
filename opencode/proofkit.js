// proofkit for OpenCode — the same lifecycle checks the Antigravity plugin has, as an OpenCode plugin.
//  - start of a session: injects the project map, lessons and an unfinished plan into the system prompt
//  - the agent stops (session.idle): runs the stop-gate (fresh .proof/report.md, screenshots opened,
//    small-fix line budget, independent review for big builds); if something is missing it sends the
//    agent one message telling it what to finish, with the same agent and model the user picked.
// The logic lives in gate.mjs (shared with the Antigravity plugin); this file only adapts it.
// Installed by `node install.mjs --agent opencode` into ~/.config/opencode/plugins/.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const GATE = '{{PROOFKIT_DIR}}/proofkit/gate.mjs'
const TMP = path.join(os.tmpdir(), 'proofkit', 'opencode')

function gate(mode, payload) {
  try {
    const r = spawnSync('node', [GATE, mode], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000, windowsHide: true })
    return JSON.parse(r.stdout || '{}')
  } catch {
    return {}
  }
}

export const ProofkitPlugin = async ({ client, directory }) => {
  const injected = new Map() // sessionID -> text added to the system prompt ('' = nothing)
  const busy = new Set()

  // Gate checks look for "a png was opened" in a transcript; build a tiny one from the session's tool calls.
  async function transcriptFor(sessionID) {
    const res = await client.session.messages({ path: { id: sessionID } })
    const msgs = res.data || []
    const lines = []
    let lastUser
    for (const m of msgs) {
      if (m.info?.role === 'user') lastUser = m.info
      for (const p of m.parts || []) {
        if (p.type !== 'tool') continue
        const input = p.state?.input || {}
        const file = input.filePath || input.path || ''
        if (p.tool === 'read' && /\.png$/i.test(String(file))) lines.push(JSON.stringify({ name: 'read_file', args: { Path: file } }))
      }
    }
    fs.mkdirSync(TMP, { recursive: true })
    const file = path.join(TMP, `${sessionID.replace(/[^\w-]/g, '')}.jsonl`)
    fs.writeFileSync(file, lines.join('\n') + '\n')
    return { file, lastUser }
  }

  return {
    // A bash call waits for every process it started. A server started inside it (`node -e "…listen()"`,
    // `npm run dev`, `python -m http.server`, even with `&`) keeps the call hanging — on Windows the
    // timeout does not kill it either. Refuse such commands and point to with_server.mjs.
    'tool.execute.before': async (input, output) => {
      if (input.tool !== 'bash') return
      const cmd = String(output.args?.command || '')
      if (/with_server\.mjs/.test(cmd)) return
      const server = /createServer|\.listen\(|http\.server|\bhttp-server\b|live-server|\bnpx\s+serve\b|\bvite(\s+(dev|preview|serve))?\s*($|[;&|]|--)|npm\s+(run\s+)?(dev|start|serve|preview)\b|next\s+dev|webpack\s+serve|\buvicorn\b|flask\s+run|php\s+-S/i
      if (!server.test(cmd.replace(/\bvite\s+build\b|npm\s+run\s+build\b/g, ''))) return
      throw new Error(
        '[proofkit] Blocked: this command starts a server inside the bash call, so the call would never return ' +
        '(on Windows the timeout does not kill it). Run the server and your check together through with_server.mjs, ' +
        'which waits for the port, runs ONE command, then kills the server and exits:\n' +
        `node "{{PROOFKIT_DIR}}/skills/proof-verify/scripts/with_server.mjs" --serve "npx vite preview --port 5577 --strictPort" --port 5577 -- node "{{PROOFKIT_DIR}}/skills/proof-verify/scripts/ui_probe.mjs" --url http://localhost:5577 ...\n` +
        'For a static index.html you need no server at all: ui_probe.mjs --dir . serves it itself. ' +
        'Static file server for your own script: --serve "python -m http.server 8123" --port 8123 -- node .proof/check.mjs'
      )
    },

    'experimental.chat.system.transform': async (input, output) => {
      const id = input.sessionID
      if (!id) return
      if (!injected.has(id)) {
        const out = gate('session-start', { conversationId: id, workspacePaths: [directory] })
        injected.set(id, out?.injectSteps?.[0]?.systemMessage?.systemMessage || '')
      }
      const text = injected.get(id)
      if (text) output.system.push(text)
    },

    event: async ({ event }) => {
      if (event.type !== 'session.idle') return
      const id = event.properties?.sessionID
      if (!id || busy.has(id)) return
      busy.add(id)
      try {
        const s = await client.session.get({ path: { id } })
        if (s.data?.parentID) return // a subagent (playtester) finished — not the user's task
        const { file, lastUser } = await transcriptFor(id)
        const out = gate('stop', { conversationId: id, workspacePaths: [s.data?.directory || directory], transcriptPath: file })
        if (out?.decision !== 'continue' || !out.reason) return
        await client.session.promptAsync({
          path: { id },
          body: {
            ...(lastUser?.agent ? { agent: lastUser.agent } : {}),
            ...(lastUser?.model ? { model: lastUser.model } : {}),
            parts: [{ type: 'text', text: out.reason }],
          },
        })
      } catch {
        // never break the user's session because of the gate
      } finally {
        busy.delete(id)
      }
    },
  }
}
