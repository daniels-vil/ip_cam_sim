import fs from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { config, ROOT } from '../shared/config.js';
import { ensureMediaMtx, mediamtxBinaryPath } from './download-mediamtx.js';

let shuttingDown = false;
const children = [];

function log(name, chunk, stream) {
  const lines = String(chunk).split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    stream.write(`[${name}] ${line}\n`);
  }
}

function spawnManaged(name, command, args, opts = {}) {
  const cwd = opts.cwd || ROOT;
  const restart = opts.restart !== false;
  const env = opts.env || process.env;

  const start = () => {
    if (shuttingDown) return;
    console.log(`[supervisor] starting ${name}`);
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const record = { name, child };
    children.push(record);

    child.stdout.on('data', (data) => log(name, data, process.stdout));
    child.stderr.on('data', (data) => log(name, data, process.stderr));
    child.on('exit', (code, signal) => {
      const index = children.indexOf(record);
      if (index >= 0) children.splice(index, 1);
      console.log(`[supervisor] ${name} exited code=${code} signal=${signal ?? ''}`);
      if (restart && !shuttingDown) setTimeout(start, 2000);
    });
  };

  start();
}

function waitForPort(port, host, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[supervisor] shutting down');
  for (const { child } of [...children].reverse()) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!fs.existsSync(config.paths.users)) {
  await import('./generate-users.js');
}

await ensureMediaMtx();

spawnManaged('mediamtx', mediamtxBinaryPath(), [config.paths.mediamtxYml], {
  cwd: config.paths.mediamtxDir,
});
await waitForPort(config.rtsp.port, config.rtsp.host);

spawnManaged('camera', process.execPath, [path.join(ROOT, 'camera', 'simulator.js')]);
spawnManaged('server-a', process.execPath, [path.join(ROOT, 'server-a', 'index.js')]);
await waitForPort(config.serverA.httpPort, config.serverA.host, 60000);
await waitForPort(config.serverA.controlPort, config.serverA.host, 60000);

spawnManaged('server-b', process.execPath, [path.join(ROOT, 'server-b', 'index.js')]);
await waitForPort(config.serverB.httpPort, config.serverB.host);

console.log(`[supervisor] web client: http://127.0.0.1:${config.serverB.httpPort}`);
console.log(`[supervisor] docs:       http://127.0.0.1:${config.serverB.httpPort}/docs`);
