import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { config } from '../shared/config.js';

export const MEDIAMTX_VERSION = 'v1.20.1';

export function mediamtxBinaryPath() {
  const name = process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx';
  return path.join(config.paths.mediamtxDir, name);
}

function archiveName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') return `mediamtx_${MEDIAMTX_VERSION}_darwin_arm64.tar.gz`;
  if (platform === 'darwin') return `mediamtx_${MEDIAMTX_VERSION}_darwin_amd64.tar.gz`;
  if (platform === 'win32') return `mediamtx_${MEDIAMTX_VERSION}_windows_amd64.zip`;
  if (platform === 'linux' && arch === 'arm64') return `mediamtx_${MEDIAMTX_VERSION}_linux_arm64.tar.gz`;
  return `mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz`;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export async function ensureMediaMtx() {
  const binary = mediamtxBinaryPath();
  if (fs.existsSync(binary)) return binary;

  fs.mkdirSync(config.paths.mediamtxDir, { recursive: true });
  const name = archiveName();
  const url = `https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${name}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediamtx-'));
  const archivePath = path.join(tmpDir, name);

  console.log(`[mediamtx] downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download MediaMTX: HTTP ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archivePath));

  if (name.endsWith('.zip')) {
    if (process.platform === 'win32') {
      await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${tmpDir}"`]);
    } else {
      await run('unzip', ['-o', archivePath, '-d', tmpDir]);
    }
  } else {
    await run('tar', ['-xzf', archivePath, '-C', tmpDir]);
  }

  const extracted = findExtractedBinary(tmpDir);
  if (!extracted) {
    throw new Error('MediaMTX binary not found in archive');
  }

  fs.copyFileSync(extracted, binary);
  if (process.platform !== 'win32') {
    fs.chmodSync(binary, 0o755);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[mediamtx] installed ${binary}`);
  return binary;
}

function findExtractedBinary(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findExtractedBinary(full);
      if (nested) return nested;
    } else if (entry.name === 'mediamtx' || entry.name === 'mediamtx.exe') {
      return full;
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('download-mediamtx.js')) {
  ensureMediaMtx().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
