import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "../shared/config.js";

const GENESIS = "GENESIS";

function secret() {
  return process.env.LOG_HMAC_SECRET || config.jwtSecret;
}

function bodyOf(entry) {
  const body = {
    timestamp: entry.timestamp,
    user: entry.user,
    message: entry.message,
  };
  if (entry.extra !== undefined) body.extra = entry.extra;
  return JSON.stringify(body);
}

export function hmacFor(prev, bodyJson) {
  return crypto
    .createHmac("sha256", secret())
    .update(`${prev}\n${bodyJson}`)
    .digest("hex");
}

function lastHmacFromFile() {
  if (!fs.existsSync(config.paths.commandsLog)) return GENESIS;
  const text = fs.readFileSync(config.paths.commandsLog, "utf8").trim();
  if (!text) return GENESIS;

  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (row && row.hmac) return row.hmac;
    } catch {}
  }
  return GENESIS;
}

let prev = null;

export function logCommand({ user, message, extra }) {
  if (prev === null) prev = lastHmacFromFile();

  const entry = {
    timestamp: new Date().toISOString(),
    user: user ?? "anonymous",
    message,
  };
  if (extra !== undefined) entry.extra = extra;

  entry.hmac = hmacFor(prev, bodyOf(entry));
  prev = entry.hmac;

  fs.appendFileSync(config.paths.commandsLog, `${JSON.stringify(entry)}\n`);
}

export function verifyLogFile(filePath = config.paths.commandsLog) {
  if (!fs.existsSync(filePath)) {
    return { ok: true, lines: 0, unsigned: 0 };
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  let chainPrev = GENESIS;
  let chained = false;
  let unsigned = 0;

  for (let i = 0; i < lines.length; i++) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      return { ok: false, error: `line ${i + 1}: not json` };
    }

    if (!row.hmac) {
      if (chained)
        return {
          ok: false,
          error: `line ${i + 1}: unsigned after chain started`,
        };
      unsigned += 1;
      continue;
    }

    const expect = hmacFor(chainPrev, bodyOf(row));
    if (row.hmac !== expect) {
      return {
        ok: false,
        error: `line ${i + 1}: hmac mismatch (edited or deleted earlier line?)`,
      };
    }
    chainPrev = row.hmac;
    chained = true;
  }

  return { ok: true, lines: lines.length, unsigned };
}
