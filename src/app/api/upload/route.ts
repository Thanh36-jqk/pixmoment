import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getClientIp, isRateLimited, uploadTokenRatelimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Issues short-lived client tokens so the browser uploads bytes straight to
// Vercel Blob instead of routing every photo through this serverless
// function — needed once uploads scale to 50-100 photos at a time, since a
// server round-trip per file would hit the function body-size limit and
// serialize all the network traffic through a single invocation.
//
// There's no user auth to gate this route on, so it's rate-limited by IP
// instead — Vercel's own docs warn a `handleUpload` route with no check in
// `onBeforeGenerateToken` is open to the public.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  // Only the actual "give me a token" request costs anything; the
  // upload-completed webhook Vercel calls afterward on this same route
  // shouldn't count against a visitor's quota.
  if (body.type === "blob.generate-client-token") {
    const ip = getClientIp(request);
    if (await isRateLimited(uploadTokenRatelimit, ip)) {
      return NextResponse.json({ error: "Too many upload requests, try again later" }, { status: 429 });
    }
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // The client is untrusted (no auth on this route) and gets to name
        // its own pathname — without this check it could request a token for
        // any path in the store. Only the two prefixes the app writes are
        // allowed: photos/ (originals) and thumbs/ (grid thumbnails).
        if (!pathname.startsWith("photos/") && !pathname.startsWith("thumbs/")) {
          throw new Error("Invalid upload path");
        }
        return {
          allowedContentTypes: ["image/*"],
          addRandomSuffix: false,
          maximumSizeInBytes: 200 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload token error" },
      { status: 400 }
    );
  }
}
