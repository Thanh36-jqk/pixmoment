import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/password";
import { deleteAlbum, readAlbum } from "@/lib/albums";

export const runtime = "nodejs";

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
