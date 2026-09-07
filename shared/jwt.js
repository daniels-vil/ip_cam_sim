import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

// logged-out tokens live here until process restart
const revoked = new Set();

export function signToken(login, role) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ login, role, jti }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    subject: login,
  });
  return { token, jti };
}

export function verifyToken(token) {
  if (!token) {
    const err = new Error('Missing token');
    err.code = 'NO_TOKEN';
    throw err;
  }

  const payload = jwt.verify(token, config.jwtSecret);
  if (revoked.has(payload.jti)) {
    const err = new Error('Token revoked');
    err.code = 'REVOKED';
    throw err;
  }
  return payload;
}

export function revokeJti(jti) {
  if (jti) revoked.add(jti);
}

export function isRevoked(jti) {
  return revoked.has(jti);
}

export function revokedJtis() {
  return [...revoked];
}

export function extractBearer(header) {
  if (!header) return null;
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
