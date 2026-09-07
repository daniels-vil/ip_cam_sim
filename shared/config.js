import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');

export const config = {
  jwtSecret: process.env.JWT_SECRET || 'dev-surveillance-jwt-secret-change-me',
  jwtExpiresIn: '1h',
  rtsp: {
    url: 'rtsp://127.0.0.1:1111/camera',
    port: 1111,
    host: '127.0.0.1',
  },
  serverA: {
    host: '127.0.0.1',
    httpPort: 3001,
    controlPort: 4000,
  },
  serverB: {
    host: '127.0.0.1',
    httpPort: 3000,
  },
  paths: {
    users: path.join(ROOT, 'users.json'),
    commandsLog: path.join(ROOT, 'commands.log'),
    font: path.join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
    client: path.join(ROOT, 'client'),
    docs: path.join(ROOT, 'docs'),
    mediamtxDir: path.join(ROOT, 'mediamtx'),
    mediamtxYml: path.join(ROOT, 'mediamtx', 'mediamtx.yml'),
  },
};

export function streamUrl(token) {
  return `ws://${config.serverA.host}:${config.serverA.httpPort}/stream?token=${encodeURIComponent(token)}`;
}
