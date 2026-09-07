import crypto from 'node:crypto';
import net from 'node:net';
import { config } from '../shared/config.js';
import { attachFramer, sendFrame } from '../shared/framing.js';
import { revokedJtis } from '../shared/jwt.js';
import { CONTROL } from '../shared/protocol.js';

const PING_MS = 5000;
const REQ_TIMEOUT = 5000;
const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 8000;

export class ControlClient {
  constructor() {
    this.sock = null;
    this.waits = new Map();
    this.backoff = BACKOFF_MIN;
    this.pingTimer = null;
    this.busy = false;
    this.connect();
  }

  get connected() {
    return !!(this.sock && !this.sock.destroyed);
  }

  connect() {
    if (this.busy || this.connected) return;
    this.busy = true;

    const sock = net.connect(config.serverA.controlPort, config.serverA.host, () => {
      this.busy = false;
      this.backoff = BACKOFF_MIN;
      this.sock = sock;
      console.log('[server-b] connected to Server A control channel');
      this.armPing();
      this.resendRevokes();
    });

    sock.setKeepAlive(true, PING_MS);
    attachFramer(sock, (msg) => this._got(msg));

    sock.on('error', (err) => {
      console.warn(`[server-b] control error: ${err.message}`);
    });

    sock.on('close', () => {
      this.busy = false;
      this.clearPing();
      this.failAll('SERVER_A_UNAVAILABLE');
      this.sock = null;
      const wait = this.backoff;
      this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX);
      console.warn(`[server-b] control disconnected - retrying in ${wait}ms`);
      setTimeout(() => this.connect(), wait);
    });
  }

  armPing() {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      if (this.connected) sendFrame(this.sock, { type: CONTROL.PING });
    }, PING_MS);
  }

  clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  resendRevokes() {
    for (const jti of revokedJtis()) {
      // best effort - next reconnect will try again if this fails
      this.request(CONTROL.REVOKE, { jti }).catch(() => {});
    }
  }

  _got(msg) {
    if (!msg?.requestId) return;
    const w = this.waits.get(msg.requestId);
    if (!w) return;
    clearTimeout(w.t);
    this.waits.delete(msg.requestId);
    if (msg.ok === false) w.reject(new Error(msg.error || 'CONTROL_ERROR'));
    else w.resolve(msg);
  }

  failAll(code) {
    for (const [id, w] of this.waits) {
      clearTimeout(w.t);
      w.reject(new Error(code));
      this.waits.delete(id);
    }
  }

  request(type, extra = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('SERVER_A_UNAVAILABLE'));
        return;
      }

      const id = crypto.randomUUID();
      const t = setTimeout(() => {
        this.waits.delete(id);
        reject(new Error('TIMEOUT'));
      }, REQ_TIMEOUT);

      this.waits.set(id, { resolve, reject, t });
      sendFrame(this.sock, { type, requestId: id, ...extra });
    });
  }
}
