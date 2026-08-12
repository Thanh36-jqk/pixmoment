import { put, get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { albumCreateRatelimit, getClientIp, isRateLimited } from "@/lib/rateLimit";
import { hashPassword } from "@/lib/password";
import { PRIVATE_BLOB_TOKEN } from "@/lib/privateBlob";
import type { AlbumSummary } from "@/types";

export const runtime = "nodejs";

// nanoid()'s default alphabet/length — see src/lib/ownerToken.ts.
const OWNER_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const MAX_HISTORY_ENTRIES = 200;

function getExpiryDate(expiresIn: string): string | undefined {
  const now = new Date();
  if (expiresIn === "1d")  return new Date(now.getTime() + 86400000).toISOString();
  if (expiresIn === "7d")  return new Date(now.getTime() + 7 * 86400000).toISOString();
  if (expiresIn === "30d") return new Date(now.getTime() + 30 * 86400000).toISOString();
  return undefined;
}

// Best-effort history index at owners/{ownerId}.json — a plain array, not a
// database, so this is a read-modify-write with no locking. Two albums
// created by the same browser in the same instant could race and one
// history entry could be lost; the album itself (and its own link) is
// unaffected either way, so that's an accepted gap rather than something
// worth adding real concurrency control for.
async function recordAlbumForOwner(
  ownerId: string,
  entry: AlbumSummary
): Promise<void> {
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

  const updated = [entry, ...history].slice(0, MAX_HISTORY_ENTRIES);
  await put(path, JSON.stringify(updated), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    token: PRIVATE_BLOB_TOKEN,
  });
}

export async function POST(req: NextRequest) {
  if (await isRateLimited(albumCreateRatelimit, getClientIp(req))) {
    return NextResponse.json({ error: "Too many requests, try again later" }, { status: 429 });
  }

  const body = await req.json();
  const { title, photos: rawPhotos, password: rawPassword, expiresIn, ownerId: rawOwnerId } = body;
  const photos = Array.isArray(rawPhotos) ? rawPhotos : [];
  const ownerId = typeof rawOwnerId === "string" && OWNER_ID_RE.test(rawOwnerId) ? rawOwnerId : null;

  const id = nanoid(10);
  const album = {
    id,
    title: title || "Album của chúng mình",
    photos,
    password: rawPassword ? hashPassword(rawPassword) : null,
    expiresAt: getExpiryDate(expiresIn) || null,
    createdAt: new Date().toISOString(),
    totalSize: photos.reduce((acc: number, p) => acc + (p.size ?? 0), 0),
    ownerId,
  };

  // Private (not public) — the JSON contains the password hash, and a
  // public blob at a predictable path (albums/{id}.json, no random suffix)
  // would let anyone who knows the share link fetch it directly, bypassing
  // this API entirely.
  await put(`albums/${id}.json`, JSON.stringify(album), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    token: PRIVATE_BLOB_TOKEN,
  });

  if (ownerId) {
    try {
      await recordAlbumForOwner(ownerId, {
        id: album.id,
        title: album.title,
        createdAt: album.createdAt,
        photoCount: photos.length,
        totalSize: album.totalSize,
        coverUrl: photos[0]?.url,
      });
    } catch {
      // History tracking is best-effort — an album must still be usable
      // (and its own link still works) even if this write fails.
    }
  }

  const { password, ownerId: _ownerId, ...safeAlbum } = album;
  return NextResponse.json(safeAlbum);
}
