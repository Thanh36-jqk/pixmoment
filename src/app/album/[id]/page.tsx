import type { Metadata } from "next";
import { readAlbum } from "@/lib/albums";
import AlbumClient from "./AlbumClient";

export const runtime = "nodejs";

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

  const cover = album.photos[0]?.thumbnailUrl ?? album.photos[0]?.url;
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
