import type { Metadata } from "next";
import { readAlbum } from "@/lib/albums";
import AlbumClient from "./AlbumClient";

export const runtime = "nodejs";
// Read the album fresh for metadata — no Data-Cache snapshot, so an edited
// title/cover is reflected in the link preview.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Per-album metadata so a shared link renders a real preview card (cover +
// title + count) in chat apps, instead of the generic site-wide tags. Runs on
// the server, so it can read the private album blob directly. A
// password-protected album deliberately reveals nothing beyond "it's
// protected" — no title, no cover — since the preview is as public as the link.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const album = await readAlbum(id);

  const expired = album?.expiresAt ? new Date(album.expiresAt) < new Date() : false;
  if (!album || expired) {
    return { title: "Pixmoment", description: "Chia sẻ ảnh chất lượng gốc." };
  }

  if (album.password) {
    return {
      title: "Album được bảo vệ · Pixmoment",
      description: "Album này cần mật khẩu để xem.",
    };
  }

  // Only ever use a real (JPEG) thumbnail as the preview image — never a raw
  // original, which for a RAW/HEIC first photo isn't a displayable image and
  // would render as a broken card. If no photo has a thumbnail, omit the image
  // and let the card fall back to the site default.
  const cover = album.photos.find((p) => p.thumbnailUrl)?.thumbnailUrl;
  const title = `${album.title} · Pixmoment`;
  const description = `${album.photos.length} ảnh chất lượng gốc — xem và tải về.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: cover ? [{ url: cover }] : undefined,
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title,
      description,
      images: cover ? [cover] : undefined,
    },
  };
}

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AlbumClient id={id} />;
}
