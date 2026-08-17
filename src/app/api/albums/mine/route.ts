import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { PRIVATE_BLOB_TOKEN } from "@/lib/privateBlob";
import type { AlbumSummary } from "@/types";

export const runtime = "nodejs";
// Keep the history index fresh — Next's Data Cache must not memoize the blob
// fetch, or "My albums" would show stale titles/covers after an edit.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// nanoid()'s default alphabet/length — see src/lib/ownerToken.ts.
const OWNER_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;

export async function GET(req: NextRequest) {
  const ownerId = req.nextUrl.searchParams.get("ownerId");
  if (!ownerId || !OWNER_ID_RE.test(ownerId)) {
    return NextResponse.json({ albums: [] });
  }

  try {
    const result = await get(`owners/${ownerId}.json`, { access: "private", token: PRIVATE_BLOB_TOKEN });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ albums: [] });
    }
    const parsed = JSON.parse(await new Response(result.stream).text());
    const albums: AlbumSummary[] = Array.isArray(parsed) ? parsed : [];
    return NextResponse.json({ albums });
  } catch {
    return NextResponse.json({ albums: [] });
  }
}
