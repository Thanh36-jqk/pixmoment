import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

// Album passwords used to be stored as plaintext in the album's JSON blob.
// That blob is fetched directly by URL elsewhere, so plaintext meant anyone
// who obtained the album id could read the real password straight out of
// storage. Salted scrypt hashing means even a direct blob read only exposes
// a hash, not the password itself.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  const hashBuffer = Buffer.from(hash, "hex");
  const candidateBuffer = scryptSync(password, salt, hashBuffer.length);

  return hashBuffer.length === candidateBuffer.length && timingSafeEqual(hashBuffer, candidateBuffer);
}
