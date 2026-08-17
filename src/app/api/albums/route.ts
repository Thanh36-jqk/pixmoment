import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { albumCreateRatelimit, getClientIp, isRateLimited } from "@/lib/rateLimit";
import { hashPassword } from "@/lib/password";
import {
  getExpiryDate,
  toAlbumSummary,
  upsertOwnerHistory,
  writeAlbum,
  type StoredAlbum,
} from "@/lib/albums";

export const runtime = "nodejs";

// nanoid()'s default alphabet/length — see src/lib/ownerToken.ts.
const OWNER_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;

export async function POST(req: NextRequest) {
  if (await isRateLimited(albumCreateRatelimit, getClientIp(req))) {
    return NextResponse.json({ error: "Too many requests, try again later" }, { status: 429 });
  }

  const body = await req.json();
  const { title, photos: rawPhotos, password: rawPassword, expiresIn, ownerId: rawOwnerId } = body;
  const photos = Array.isArray(rawPhotos) ? rawPhotos : [];
  const ownerId = typeof rawOwnerId === "string" && OWNER_ID_RE.test(rawOwnerId) ? rawOwnerId : null;

  const id = nanoid(10);
  const album: StoredAlbum = {
    id,
    title: title || "Album của chúng mình",
    photos,
    password: rawPassword ? hashPassword(rawPassword) : null,
    expiresAt: getExpiryDate(expiresIn) || null,
    createdAt: new Date().toISOString(),
    totalSize: photos.reduce((acc: number, p) => acc + (p.size ?? 0), 0),
    ownerId,
  };

  // Private (not public) — the JSON contains the password hash, and a public
  // blob at a predictable path (albums/{id}.json, no random suffix) would let
  // anyone who knows the share link fetch it directly, bypassing this API.
  await writeAlbum(album);

  if (ownerId) {
    try {
      await upsertOwnerHistory(ownerId, toAlbumSummary(album));
    } catch {
      // History tracking is best-effort — an album must still be usable
      // (and its own link still works) even if this write fails.
    }
  }

  const { password, ownerId: _ownerId, ...safeAlbum } = album;
  return NextResponse.json(safeAlbum);
}
