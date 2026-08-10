import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Issues short-lived client tokens so the browser uploads bytes straight to
// Vercel Blob instead of routing every photo through this serverless
// function — needed once uploads scale to 50-100 photos at a time, since a
// server round-trip per file would hit the function body-size limit and
// serialize all the network traffic through a single invocation.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/*"],
        addRandomSuffix: false,
        maximumSizeInBytes: 200 * 1024 * 1024,
      }),
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
