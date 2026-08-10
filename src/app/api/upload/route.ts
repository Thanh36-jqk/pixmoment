import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const filename = `photos/${nanoid()}.${ext}`;

  const blob = await put(filename, file, {
    access: "public",
    contentType: file.type,
  });

  return NextResponse.json({
    url: blob.url,
    name: file.name,
    size: file.size,
    type: file.type,
  });
}
