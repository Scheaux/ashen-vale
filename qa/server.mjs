/**
 * Shared QA preview-server management. Vite runs as a direct node process in
 * its own process group so it can always be killed reliably — the previous
 * `npx vite` wrapper left orphaned children listening on ports after QA runs.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const running = new Set();

export function startPreviewServer(port = 4173) {
  const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--host'], {
    cwd: projectRoot,
    stdio: 'ignore',
    detached: true, // own process group: kill the whole tree, not just the leader
  });
  server.unref();
  running.add(server);
  return server;
}

export function stopServer(server) {
  if (!server) return;
  running.delete(server);
  try {
    process.kill(-server.pid, 'SIGTERM'); // whole process group
  } catch {
    try {
      server.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function stopAll() {
  for (const server of [...running]) stopServer(server);
}

process.on('exit', stopAll);
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(143);
});
