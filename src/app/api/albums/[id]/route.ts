import { NextRequest, NextResponse } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  deleteAlbum,
  deletePublicBlobs,
  getExpiryDate,
  readAlbum,
  toAlbumSummary,
  upsertOwnerHistory,
  writeAlbum,
  type StoredPhoto,
} from "@/lib/albums";
import { albumUnlockRatelimit, getClientIp, isRateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";
// The album JSON is fetched (internally by @vercel/blob's get) on every read.
// Without this, Next's Data Cache can memoize that fetch and keep serving a
// stale album after an edit/password change. Force every read fresh.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// nanoid()'s default alphabet/length — see src/lib/ownerToken.ts.
const OWNER_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const album = await readAlbum(id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    // Check expiry
    if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
      return NextResponse.json({ error: "Album expired" }, { status: 410 });
    }

    // The owner (proven by presenting the ownerId stored on the album) gets the
    // full album regardless of password — this is what the edit page loads
    // from. The ownerId is a secret held only by the creating browser.
    const requesterOwnerId = req.nextUrl.searchParams.get("ownerId");
    if (album.ownerId && requesterOwnerId === album.ownerId) {
      const { password, ownerId: _ownerId, ...safeAlbum } = album;
      return NextResponse.json({ ...safeAlbum, hasPassword: !!password, isOwner: true });
    }

    // A password-protected album must NOT hand out its photos here — this
    // route is unauthenticated, so returning the photo list (URLs point at a
    // public blob store) would let anyone with the album id bypass the
    // password entirely by reading it straight off the API. Only expose that
    // a password is required; the photos come back solely from POST below,
    // after verifyPassword succeeds.
    if (album.password) {
      return NextResponse.json({ id: album.id, hasPassword: true });
    }

    // No password — safe to return, minus the (empty) hash and owner id.
    const { password, ownerId: _ownerId, ...safeAlbum } = album;
    return NextResponse.json({ ...safeAlbum, hasPassword: false });
  } catch {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Rate-limit password guesses per IP+album so this can't be used as an
  // unlimited brute-force oracle.
  if (await isRateLimited(albumUnlockRatelimit, `${getClientIp(req)}:${id}`)) {
    return NextResponse.json({ error: "Quá nhiều lần thử, đợi một lát rồi thử lại" }, { status: 429 });
  }

  const { password: inputPassword } = await req.json();

  try {
    const album = await readAlbum(id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    if (!album.password || typeof inputPassword !== "string" || !verifyPassword(inputPassword, album.password)) {
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }

    const { password, ownerId: _ownerId, ...safeAlbum } = album;
    return NextResponse.json({ ...safeAlbum, hasPassword: true });
  } catch {
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

// Deletes an album and all of its photos. There's no login, so the per-browser
// ownerId (src/lib/ownerToken.ts) that created the album is the proof of
// ownership: the caller must present the same id that's stored on the album.
// Anonymous albums (no ownerId) can't be deleted this way — nothing to check
// against — which is the accepted cost of skipping real accounts.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let ownerId: unknown;
  try {
    ({ ownerId } = await req.json());
  } catch {
    ownerId = undefined;
  }
  if (typeof ownerId !== "string" || !OWNER_ID_RE.test(ownerId)) {
    return NextResponse.json({ error: "Missing owner id" }, { status: 400 });
  }

  try {
    const album = await readAlbum(id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    if (!album.ownerId || album.ownerId !== ownerId) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    await deleteAlbum(album);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}

// Edits an album (owner-authenticated like DELETE). The client sends the new
// full ordered photo list — so add/remove/reorder/set-cover are all just "here
// is the album's photos now". Photos dropped from that list have their blobs
// (original + thumbnail) deleted. Title, password (set/remove), and expiry can
// be changed in the same call.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const ownerId = body?.ownerId;
  if (typeof ownerId !== "string" || !OWNER_ID_RE.test(ownerId)) {
    return NextResponse.json({ error: "Missing owner id" }, { status: 400 });
  }

  try {
    const album = await readAlbum(id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    if (!album.ownerId || album.ownerId !== ownerId) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    if (typeof body.title === "string" && body.title.trim()) {
      album.title = body.title.trim().slice(0, 200);
    }

    if (Array.isArray(body.photos)) {
      const incoming = (body.photos as unknown[]).filter(
        (p): p is StoredPhoto => !!p && typeof (p as StoredPhoto).url === "string"
      );
      if (incoming.length === 0) {
        return NextResponse.json({ error: "Album phải có ít nhất 1 ảnh" }, { status: 400 });
      }
      // Delete the blobs of photos that are no longer in the album.
      const keptUrls = new Set(incoming.map((p) => p.url));
      const removed = album.photos.filter((p) => !keptUrls.has(p.url));
      await deletePublicBlobs(removed.flatMap((p) => [p.url, p.thumbnailUrl]));
      // Normalize to just the fields we store, preserving the client's order.
      album.photos = incoming.map((p) => ({
        name: String(p.name ?? "photo"),
        size: Number(p.size) || 0,
        type: String(p.type ?? ""),
        url: p.url,
        thumbnailUrl: typeof p.thumbnailUrl === "string" ? p.thumbnailUrl : undefined,
      }));
      album.totalSize = album.photos.reduce((acc, p) => acc + (p.size || 0), 0);
    }

    if (body.removePassword === true) {
      album.password = null;
    } else if (typeof body.password === "string" && body.password.length > 0) {
      album.password = hashPassword(body.password);
    }

    if (typeof body.expiresIn === "string") {
      album.expiresAt = getExpiryDate(body.expiresIn) ?? null;
    }

    await writeAlbum(album);
    try {
      await upsertOwnerHistory(ownerId, toAlbumSummary(album));
    } catch {
      // History index is best-effort.
    }

    const { password, ownerId: _ownerId, ...safeAlbum } = album;
    return NextResponse.json({ ...safeAlbum, hasPassword: !!password });
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
