import { list } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { blobs } = await list({ prefix: `albums/${id}.json` });
    if (blobs.length === 0) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const res = await fetch(blobs[0].url);
    const album = await res.json();

    // Check expiry
    if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
      return NextResponse.json({ error: "Album expired" }, { status: 410 });
    }

    // Don't expose password in response
    const { password, ...safeAlbum } = album;
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
    const { blobs } = await list({ prefix: `albums/${id}.json` });
    if (blobs.length === 0) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const res = await fetch(blobs[0].url);
    const album = await res.json();

    if (album.password !== inputPassword) {
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }

    const { password, ...safeAlbum } = album;
    return NextResponse.json({ ...safeAlbum, hasPassword: true });
  } catch {
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
