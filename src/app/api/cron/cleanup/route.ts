import { list } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { PRIVATE_BLOB_TOKEN } from "@/lib/privateBlob";
import { deleteAlbum, readAlbum } from "@/lib/albums";

export const runtime = "nodejs";
// Read fresh — the sweep must see current expiry, not a Data-Cache snapshot.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Expiry used to be enforced only at read time (GET returns 410 for an expired
// album), but the underlying photos — on the PUBLIC store, reachable by their
// direct URL — and the album JSON were never actually removed, so "expired"
// data lived on indefinitely, still downloadable and still billed for. This
// job is the missing half: it sweeps the store and hard-deletes anything past
// its expiresAt. Scheduled from vercel.json.
//
// Vercel Cron invokes it over GET and, when CRON_SECRET is set, includes it as
// `Authorization: Bearer <secret>`. We require that match so the endpoint
// can't be triggered (or scraped for album ids) by the public.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — an unset secret means "not configured", not "open"
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const ALBUM_PREFIX = "albums/";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let scanned = 0;
  let deleted = 0;
  let cursor: string | undefined;

  try {
    // Paginate the whole albums/ prefix — the store can hold more than one
    // page (default 1000) once enough albums exist.
    do {
      const page = await list({ prefix: ALBUM_PREFIX, cursor, token: PRIVATE_BLOB_TOKEN });
      for (const blob of page.blobs) {
        scanned++;
        const id = blob.pathname.slice(ALBUM_PREFIX.length).replace(/\.json$/, "");
        const album = await readAlbum(id);
        if (!album?.expiresAt) continue;
        if (new Date(album.expiresAt) < now) {
          await deleteAlbum(album);
          deleted++;
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return NextResponse.json({ ok: true, scanned, deleted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cleanup failed", scanned, deleted },
      { status: 500 }
    );
  }
}
