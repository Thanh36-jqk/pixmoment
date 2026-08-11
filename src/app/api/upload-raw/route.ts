import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getClientIp, isRateLimited, uploadRawRatelimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Called by iOS Shortcut — receives raw binary body, not multipart.
// Unlike /api/upload there's no token step at all here, so this is rate
// limited the same way for the same reason: no auth to gate on.
export async function POST(req: NextRequest) {
  if (await isRateLimited(uploadRawRatelimit, getClientIp(req))) {
    return NextResponse.json({ error: "Too many upload requests, try again later" }, { status: 429 });
  }

  const contentType = req.headers.get("content-type") ?? "image/jpeg";
  const filename = req.headers.get("x-filename") ?? `photo-${nanoid()}.jpg`;
  const ext = filename.split(".").pop() ?? "jpg";
  const blobPath = `photos/${nanoid()}.${ext}`;

  const body = await req.arrayBuffer();
  if (!body.byteLength) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  const blob = await put(blobPath, Buffer.from(body), {
    access: "public",
    contentType,
  });

  return NextResponse.json({
    url: blob.url,
    name: filename,
    size: body.byteLength,
    type: contentType,
  });
}
