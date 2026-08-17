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
  thumbnailUrl?: string;
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
  try {
    const result = await get(`albums/${id}.json`, { access: "private", token: PRIVATE_BLOB_TOKEN });
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text()) as StoredAlbum;
  } catch {
    // Blob fetch/parse failure (network, bad token, malformed JSON) — treat as
    // "not found" so callers (incl. generateMetadata) degrade gracefully.
    return null;
  }
}

const MAX_HISTORY_ENTRIES = 200;

// Persists an album's JSON to the private store (create or overwrite).
export async function writeAlbum(album: StoredAlbum): Promise<void> {
  await put(`albums/${album.id}.json`, JSON.stringify(album), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    token: PRIVATE_BLOB_TOKEN,
  });
}

// Inserts or updates one album's entry in its owner's history index, newest
// first. Used by both create and edit: an existing entry for the same id is
// replaced (so edits refresh title/count/cover) rather than duplicated.
// Best-effort read-modify-write with no locking — a lost/stale history entry
// never breaks the album itself.
export async function upsertOwnerHistory(ownerId: string, entry: AlbumSummary): Promise<void> {
  const path = `owners/${ownerId}.json`;
  let history: AlbumSummary[] = [];
  try {
    const existing = await get(path, { access: "private", token: PRIVATE_BLOB_TOKEN });
    if (existing && existing.statusCode === 200) {
      const parsed = JSON.parse(await new Response(existing.stream).text());
      if (Array.isArray(parsed)) history = parsed;
    }
  } catch {
    // No history yet for this owner — start fresh.
  }
  const without = (history as AlbumSummary[]).filter((a) => a.id !== entry.id);
  const updated = [entry, ...without].slice(0, MAX_HISTORY_ENTRIES);
  await put(path, JSON.stringify(updated), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    token: PRIVATE_BLOB_TOKEN,
  });
}

// Builds the history-index summary for an album (title/count/size + cover).
// Cover prefers a real thumbnail so the "My albums" list never points at a
// non-displayable RAW/HEIC original.
export function toAlbumSummary(album: StoredAlbum): AlbumSummary {
  return {
    id: album.id,
    title: album.title,
    createdAt: album.createdAt,
    photoCount: album.photos.length,
    totalSize: album.totalSize,
    coverUrl: album.photos.find((p) => p.thumbnailUrl)?.thumbnailUrl ?? album.photos[0]?.url,
  };
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
// Deletes a set of public-store blobs (photo originals and/or thumbnails) by
// URL. Best-effort — used both for full album deletion and for the photos
// dropped during an edit. A failure (already gone, token unset) is swallowed.
export async function deletePublicBlobs(urls: (string | undefined)[]): Promise<void> {
  const clean = urls.filter((u): u is string => Boolean(u));
  if (clean.length === 0) return;
  try {
    await del(clean, { token: PUBLIC_BLOB_TOKEN });
  } catch {
    // ignore
  }
}

export async function deleteAlbum(album: StoredAlbum): Promise<void> {
  // Both the originals and their thumbnails live on the public store.
  await deletePublicBlobs((album.photos ?? []).flatMap((p) => [p.url, p.thumbnailUrl]));

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
