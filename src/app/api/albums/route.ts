import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { albumCreateRatelimit, getClientIp, isRateLimited } from "@/lib/rateLimit";
import { hashPassword } from "@/lib/password";

export const runtime = "nodejs";

function getExpiryDate(expiresIn: string): string | undefined {
  const now = new Date();
  if (expiresIn === "1d")  return new Date(now.getTime() + 86400000).toISOString();
  if (expiresIn === "7d")  return new Date(now.getTime() + 7 * 86400000).toISOString();
  if (expiresIn === "30d") return new Date(now.getTime() + 30 * 86400000).toISOString();
  return undefined;
}

export async function POST(req: NextRequest) {
  if (await isRateLimited(albumCreateRatelimit, getClientIp(req))) {
    return NextResponse.json({ error: "Too many requests, try again later" }, { status: 429 });
  }

  const body = await req.json();
  const { title, photos: rawPhotos, password: rawPassword, expiresIn } = body;

  // Shortcut gửi mảng URL strings, web app gửi mảng photo objects
  // Normalise cả hai dạng về cùng format
  const photos = Array.isArray(rawPhotos)
    ? rawPhotos.map((p: string | { url: string; name?: string; size?: number; type?: string }) =>
        typeof p === "string"
          ? { url: p, name: p.split("/").pop() ?? "photo.heic", size: 0, type: "image/heic" }
          : p
      )
    : [];

  const id = nanoid(10);
  const album = {
    id,
    title: title || "Album của chúng mình",
    photos,
    password: rawPassword ? hashPassword(rawPassword) : null,
    expiresAt: getExpiryDate(expiresIn) || null,
    createdAt: new Date().toISOString(),
    totalSize: photos.reduce((acc: number, p) => acc + (p.size ?? 0), 0),
  };

  // Private (not public) — the JSON contains the password hash, and a
  // public blob at a predictable path (albums/{id}.json, no random suffix)
  // would let anyone who knows the share link fetch it directly, bypassing
  // this API entirely.
  await put(`albums/${id}.json`, JSON.stringify(album), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
  });

  const { password, ...safeAlbum } = album;
  return NextResponse.json(safeAlbum);
}
