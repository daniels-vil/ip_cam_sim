import crypto from 'node:crypto';

const ALGORITHM = 'RSA-OAEP-SHA256';
const MODULUS_BITS = 2048;

let keyPair = null;

export function ensureCommandKeys() {
  if (keyPair) return keyPair;
  keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: MODULUS_BITS,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return keyPair;
}

export function getPublicKeyPayload() {
  const { publicKey } = ensureCommandKeys();
  return {
    algorithm: ALGORITHM,
    hash: 'SHA-256',
    modulusLength: MODULUS_BITS,
    publicKey,
  };
}

export function isEncryptedEnvelope(raw) {
  try {
    const obj = JSON.parse(String(raw ?? ''));
    return Boolean(
      obj
      && typeof obj === 'object'
      && obj.ciphertext
      && (obj.alg === ALGORITHM || obj.algorithm === ALGORITHM || obj.enc === true),
    );
  } catch {
    return false;
  }
}

export function decryptCommandMessage(raw) {
  ensureCommandKeys();
  let envelope;
  try {
    envelope = JSON.parse(String(raw));
  } catch {
    throw Object.assign(new Error('INVALID_CIPHERTEXT'), { code: 'BAD_ENVELOPE' });
  }

  const b64 = envelope?.ciphertext;
  if (!b64 || typeof b64 !== 'string') {
    throw Object.assign(new Error('INVALID_CIPHERTEXT'), { code: 'BAD_ENVELOPE' });
  }

  try {
    const plain = crypto.privateDecrypt(
      {
        key: keyPair.privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(b64, 'base64'),
    );
    return plain.toString('utf8');
  } catch {
    throw Object.assign(new Error('DECRYPT_FAILED'), { code: 'DECRYPT_FAILED' });
  }
}
