import { del, get, put } from "@vercel/blob";
import { PRIVATE_BLOB_TOKEN } from "./privateBlob";
import type { AlbumSummary } from "@/types";

// Photos live on the DEFAULT (public) Blob store, so deleting them needs that
// store's read-write token — the private token used for album/owner JSON
// can't touch them.
const PUBLIC_BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// nanoid(10)'s default alphabet — album ids. Kept here (not just in the route)
// so every server-side reader validates the id before building a blob path.
export const VALID_ALBUM_ID = /^[A-Za-z0-9_-]{1,32}$/;

const DAY_MS = 86_400_000;

// Maps the UI's expiry choice to an absolute ISO timestamp. Unknown values
// (including "never") return undefined — i.e. no expiry.
export function getExpiryDate(expiresIn: string, now: Date = new Date()): string | undefined {
  if (expiresIn === "1d")  return new Date(now.getTime() + DAY_MS).toISOString();
  if (expiresIn === "7d")  return new Date(now.getTime() + 7 * DAY_MS).toISOString();
  if (expiresIn === "30d") return new Date(now.getTime() + 30 * DAY_MS).toISOString();
  return undefined;
}

export interface StoredPhoto {
  name: string;
  size: number;
  type: string;
  url: string;
}

// The album exactly as persisted — includes the fields the API strips before
// returning to clients (password hash, ownerId). Server-side use only.
export interface StoredAlbum {
  id: string;
  title: string;
  photos: StoredPhoto[];
  createdAt: string;
  password?: string | null;
  expiresAt?: string | null;
  totalSize: number;
  ownerId?: string | null;
}

// Reads the raw album JSON from the private store. Returns null for an invalid
// id or a missing/unreadable blob, so callers get one uniform "not found".
export async function readAlbum(id: string): Promise<StoredAlbum | null> {
  if (!VALID_ALBUM_ID.test(id)) return null;
  const result = await get(`albums/${id}.json`, { access: "private", token: PRIVATE_BLOB_TOKEN });
  if (!result || result.statusCode !== 200) return null;
  try {
    return JSON.parse(await new Response(result.stream).text()) as StoredAlbum;
  } catch {
    return null;
  }
}

// Drops one album's entry from its owner's history index. Best-effort, same as
// the write side in /api/albums — the read-modify-write has no locking, but a
// lost/stale history entry never breaks the album itself.
async function removeFromOwnerHistory(ownerId: string, albumId: string): Promise<void> {
  const path = `owners/${ownerId}.json`;
  const existing = await get(path, { access: "private", token: PRIVATE_BLOB_TOKEN });
  if (!existing || existing.statusCode !== 200) return;
  const parsed = JSON.parse(await new Response(existing.stream).text());
  if (!Array.isArray(parsed)) return;
  const filtered = (parsed as AlbumSummary[]).filter((a) => a.id !== albumId);
  if (filtered.length === parsed.length) return; // nothing to remove
  await put(path, JSON.stringify(filtered), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    token: PRIVATE_BLOB_TOKEN,
  });
}

// Fully deletes an album: its photos (public store), its JSON (private store),
// and its owner-history entry. Each step is isolated so a failure in one (e.g.
// a photo already gone) doesn't leave the others undone — the goal is "as
// deleted as possible", not an all-or-nothing transaction.
export async function deleteAlbum(album: StoredAlbum): Promise<void> {
  const photoUrls = album.photos?.map((p) => p.url).filter(Boolean) ?? [];
  if (photoUrls.length > 0) {
    try {
      await del(photoUrls, { token: PUBLIC_BLOB_TOKEN });
    } catch {
      // Photos may already be gone, or the public token unset in this env —
      // still remove the JSON below so the album stops resolving.
    }
  }

  try {
    await del(`albums/${album.id}.json`, { token: PRIVATE_BLOB_TOKEN });
  } catch {
    // Nothing more we can do here; a re-run of cleanup will retry.
  }

  if (album.ownerId) {
    try {
      await removeFromOwnerHistory(album.ownerId, album.id);
    } catch {
      // History is a convenience index, not source of truth — safe to skip.
    }
  }
}
