import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { WebSocket } from 'ws';
import { config } from '../shared/config.js';

const RESTART_AFTER = 2000;
// ~0.5MB of recent TS enough to usually hit a keyframe
const maxPreroll = 512 * 1024;

export class VideoHub {
  constructor() {
    this.videoRunning = true;
    this.ingestAlive = false;
    this.clients = new Set();
    this.ff = null;
    this.stopping = false;
    this.buf = [];
    this.bufSize = 0;
  }

  start() {
    this.startIngest();
  }

  stopIngest() {
    this.stopping = true;
    if (this.ff) {
      this.ff.kill('SIGTERM');
      this.ff = null;
    }
  }

  addClient(ws) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    if (this.videoRunning) this.flushBuf(ws);
  }

  startVideo() {
    this.videoRunning = true;
    for (const c of this.clients) this.flushBuf(c);
    return this.getStatus();
  }

  stopVideo() {
    this.videoRunning = false;
    return this.getStatus();
  }

  getStatus() {
    return {
      videoRunning: this.videoRunning,
      ingestAlive: this.ingestAlive,
      clientCount: this.clients.size,
    };
  }

  revoke(jti) {
    for (const c of [...this.clients]) {
      if (c.jti === jti) c.close(4401, 'Token revoked');
    }
  }

  stash(chunk) {
    this.buf.push(chunk);
    this.bufSize += chunk.length;
    while (this.bufSize > maxPreroll && this.buf.length > 1) {
      const old = this.buf.shift();
      this.bufSize -= old.length;
    }
  }

  flushBuf(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;
    for (let i = 0; i < this.buf.length; i++) {
      ws.send(this.buf[i], { binary: true });
    }
  }

  // fan out current chunk to everyone who's still connected
  pump(chunk) {
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
    });
  }

  startIngest() {
    if (this.stopping) return;
    if (!ffmpegPath) throw new Error('ffmpeg-static missing');

    this.buf = [];
    this.bufSize = 0;

    // copy only - camera already encoded h264
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-nostdin',
      '-rtsp_transport', 'tcp',
      '-i', config.rtsp.url,
      '-c', 'copy',
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-pat_period', '0.1',
      '-mpegts_flags', '+resend_headers+pat_pmt_at_frames',
      '-f', 'mpegts',
      'pipe:1',
    ];

    console.log('[server-a] starting RTSP ingest (copy ->MPEG-TS)');
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true, // otherwise windows pops a console for ffmpeg
    });
    this.ff = child;

    child.stdout.on('data', (chunk) => {
      this.ingestAlive = true;
      this.stash(chunk);
      if (this.videoRunning) this.pump(chunk);
    });

    child.stderr.on('data', (data) => {
      const text = String(data).trim();
      if (text) console.log(`[server-a:ffmpeg] ${text}`);
    });

    child.on('exit', (code, signal) => {
      this.ingestAlive = false;
      if (this.ff === child) this.ff = null;
      if (this.stopping) return;
      console.warn(`[server-a] ingest exited code=${code} signal=${signal ?? ''} -restarting in ${RESTART_AFTER}ms`);
      setTimeout(() => this.startIngest(), RESTART_AFTER);
    });
  }
}
