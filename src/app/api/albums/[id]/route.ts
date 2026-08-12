import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/password";
import { PRIVATE_BLOB_TOKEN } from "@/lib/privateBlob";

export const runtime = "nodejs";

// nanoid's default alphabet — album ids are generated with nanoid(10).
const VALID_ID = /^[A-Za-z0-9_-]{1,32}$/;

// Album JSON is written with access: "private" (see /api/albums) — get()
// is the SDK's authenticated read path for that; a plain fetch(url) only
// works for public blobs, which is exactly what let anyone bypass the
// password check before by hitting the storage URL directly.
async function readAlbum(id: string) {
  if (!VALID_ID.test(id)) return null;
  const result = await get(`albums/${id}.json`, { access: "private", token: PRIVATE_BLOB_TOKEN });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

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

    // Don't expose the password hash or the creator's owner id
    const { password, ownerId: _ownerId, ...safeAlbum } = album;
    return NextResponse.json({
      ...safeAlbum,
      hasPassword: !!password,
    });
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
