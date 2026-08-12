"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ImageIcon, Loader2, Heart } from "lucide-react";
import { formatBytes, formatDate } from "@/lib/utils";
import { getOwnerId } from "@/lib/ownerToken";
import type { AlbumSummary } from "@/types";

export default function MyAlbumsPage() {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const ownerId = getOwnerId();
      if (!ownerId) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/albums/mine?ownerId=${ownerId}`);
        const data = await res.json();
        setAlbums(Array.isArray(data.albums) ? data.albums : []);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] bg-mesh">
      <header className="relative z-10 flex items-center gap-3 px-6 py-5 border-b border-white/5">
        <Link href="/" className="text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center">
          <Heart className="w-3.5 h-3.5 text-white fill-white" />
        </div>
        <span className="font-bold text-lg gradient-text tracking-tight">Album của tôi</span>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
          </div>
        ) : albums.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <ImageIcon className="w-10 h-10 text-white/15 mx-auto" />
            <p className="text-white/40 text-sm">
              Chưa có album nào được tạo trên trình duyệt này.
            </p>
            <p className="text-white/25 text-xs max-w-xs mx-auto">
              Lịch sử được lưu riêng theo trình duyệt/thiết bị — đổi máy hoặc xoá dữ liệu trình duyệt sẽ mất lịch sử này.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {albums.map((album, i) => (
              <motion.a
                key={album.id}
                href={`/album/${album.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="glass rounded-2xl p-4 flex items-center gap-4 hover:bg-white/[0.07] transition-colors"
              >
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-white/5 shrink-0">
                  {album.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={album.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white/90 truncate">{album.title}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {album.photoCount} ảnh · {formatBytes(album.totalSize)} · {formatDate(new Date(album.createdAt))}
                  </p>
                </div>
              </motion.a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
