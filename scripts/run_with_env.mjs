// Helper for the proofkit pre-tool hook: runs `npm|npx|python ...` with the environment that
// `node --env-file=...` loaded into this process. Only these three tools are accepted.
import { spawn } from 'node:child_process';

const [tool, ...args] = process.argv.slice(2);
if (!['npm', 'npx', 'python', 'python3'].includes(tool)) {
  console.error(`run_with_env: refusing to run "${tool}"`);
  process.exit(2);
}
const child = spawn(tool, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' && tool !== 'python' && tool !== 'python3' });
child.on('exit', code => process.exit(code ?? 1));
