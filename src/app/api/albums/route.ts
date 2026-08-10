import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

function getExpiryDate(expiresIn: string): string | undefined {
  const now = new Date();
  if (expiresIn === "1d")  return new Date(now.getTime() + 86400000).toISOString();
  if (expiresIn === "7d")  return new Date(now.getTime() + 7 * 86400000).toISOString();
  if (expiresIn === "30d") return new Date(now.getTime() + 30 * 86400000).toISOString();
  return undefined;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, photos: rawPhotos, password, expiresIn } = body;

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
    password: password || null,
    expiresAt: getExpiryDate(expiresIn) || null,
    createdAt: new Date().toISOString(),
    totalSize: photos.reduce((acc: number, p) => acc + (p.size ?? 0), 0),
  };

  await put(`albums/${id}.json`, JSON.stringify(album), {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true,
  });

  return NextResponse.json(album);
}
