"use client";

import { useState, useEffect, use } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, Archive, Heart, ArrowLeft, Lock,
  ImageIcon, Info, X, ChevronLeft, ChevronRight,
  CheckCircle2, Calendar, HardDrive, Eye
} from "lucide-react";
import { cn, formatBytes, formatDate } from "@/lib/utils";

interface Photo {
  name: string;
  size: number;
  type: string;
  url: string;
}

interface Album {
  id: string;
  title: string;
  photos: Photo[];
  createdAt: string;
  totalSize: number;
  hasPassword: boolean;
  expiresAt?: string;
}

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [zipDone, setZipDone] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    fetchAlbum();
  }, [id]);

  const fetchAlbum = async () => {
    setLoading(true);
    const res = await fetch(`/api/albums/${id}`);
    const data = await res.json();

    if (res.status === 404) { setError("Không tìm thấy album"); setLoading(false); return; }
    if (res.status === 410) { setError("Album đã hết hạn"); setLoading(false); return; }

    if (data.hasPassword) {
      setNeedsPassword(true);
      setLoading(false);
      return;
    }

    setAlbum(data);
    setLoading(false);
  };

  const unlockAlbum = async () => {
    const res = await fetch(`/api/albums/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) { setPwError(true); return; }
    const data = await res.json();
    setAlbum(data);
    setNeedsPassword(false);
  };

  const downloadPhoto = async (photo: Photo) => {
    setDownloading(photo.url);
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = photo.name;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setTimeout(() => setDownloading(null), 1000);
    }
  };

  const downloadAllAsZip = async () => {
    if (!album) return;
    setZipping(true);

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const folder = zip.folder(album.title) ?? zip;

    await Promise.all(
      album.photos.map(async (photo) => {
        const res = await fetch(photo.url);
        const blob = await res.blob();
        folder.file(photo.name, blob);
      })
    );

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${album.title}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    setZipping(false);
    setZipDone(true);
    setTimeout(() => setZipDone(false), 3000);
  };

  const prevPhoto = () => {
    if (lightbox === null || !album) return;
    setLightbox((lightbox - 1 + album.photos.length) % album.photos.length);
  };

  const nextPhoto = () => {
    if (lightbox === null || !album) return;
    setLightbox((lightbox + 1) % album.photos.length);
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 rounded-full border-2 border-purple-400 border-t-transparent"
        />
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] bg-mesh flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="text-6xl">💔</div>
          <h1 className="text-2xl font-bold text-white">{error}</h1>
          <a href="/" className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Tạo album mới
          </a>
        </div>
      </div>
    );
  }

  // ── Password gate ──
  if (needsPassword) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] bg-mesh flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass rounded-2xl p-8 w-full max-w-sm space-y-6 text-center"
        >
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-400/20 flex items-center justify-center">
            <Lock className="w-8 h-8 text-purple-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Album được bảo vệ</h2>
            <p className="text-white/40 text-sm mt-1">Nhập mật khẩu để xem ảnh</p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              placeholder="Mật khẩu..."
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPwError(false); }}
              onKeyDown={(e) => e.key === "Enter" && unlockAlbum()}
              className={cn(
                "w-full bg-white/5 border rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none transition-colors",
                pwError ? "border-red-500/60" : "border-white/10 focus:border-purple-400/50"
              )}
            />
            {pwError && <p className="text-red-400 text-xs">Mật khẩu không đúng</p>}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={unlockAlbum}
              className="btn-primary w-full py-3 rounded-xl font-semibold text-white"
            >
              Mở album
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!album) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] bg-mesh">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-80 h-80 rounded-full bg-purple-600/8 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full bg-pink-600/8 blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/5 glass">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-4">
          <a href="/" className="w-9 h-9 rounded-xl glass border border-white/10 flex items-center justify-center hover:border-purple-400/30 transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </a>

          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-white truncate text-sm sm:text-base">{album.title}</h1>
            <p className="text-xs text-white/30 truncate">
              {album.photos.length} ảnh · {formatBytes(album.totalSize)}
              <span className="hidden sm:inline"> · {formatDate(new Date(album.createdAt))}</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={() => setInfoOpen(!infoOpen)}
              className="w-9 h-9 rounded-xl glass border border-white/10 flex items-center justify-center hover:border-purple-400/30 transition-colors"
            >
              <Info className="w-4 h-4 text-white/60" />
            </button>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={downloadAllAsZip}
              disabled={zipping}
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white transition-all",
                zipDone ? "bg-green-500" : "btn-primary"
              )}
            >
              {zipping ? (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4 rounded-full border-2 border-white border-t-transparent" />
                  <span className="hidden sm:inline">Đang nén...</span>
                </>
              ) : zipDone ? (
                <><CheckCircle2 className="w-4 h-4" /><span className="hidden sm:inline"> Đã tải!</span></>
              ) : (
                <><Archive className="w-4 h-4" /><span className="hidden sm:inline"> Tải ZIP</span><span className="sm:hidden">ZIP</span></>
              )}
            </motion.button>
          </div>
        </div>
      </header>

      {/* Info panel */}
      <AnimatePresence>
        {infoOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-white/5 overflow-hidden"
          >
            <div className="max-w-6xl mx-auto px-4 py-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { icon: ImageIcon, label: "Số ảnh", value: `${album.photos.length} ảnh` },
                  { icon: HardDrive, label: "Tổng dung lượng", value: formatBytes(album.totalSize) },
                  { icon: Calendar, label: "Ngày tạo", value: formatDate(new Date(album.createdAt)) },
                  { icon: Eye, label: "Chất lượng", value: "Gốc 100%" },
                ].map((item) => (
                  <div key={item.label} className="glass rounded-xl p-3 flex items-center gap-3">
                    <item.icon className="w-4 h-4 text-purple-400 shrink-0" />
                    <div>
                      <p className="text-xs text-white/30">{item.label}</p>
                      <p className="text-sm font-semibold text-white">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Masonry gallery */}
      <main className="max-w-6xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
        <div className="masonry">
          {album.photos.map((photo, i) => (
            <motion.div
              key={photo.url}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.4 }}
              className="masonry-item"
            >
              <div className="photo-card group relative rounded-xl overflow-hidden bg-white/5 cursor-pointer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.name}
                  className="w-full h-auto block"
                  onClick={() => setLightbox(i)}
                  loading="lazy"
                />

                {/* Overlay — always visible on mobile (no hover), hover on desktop */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-300">
                  <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-3 flex items-end justify-between">
                    <div className="min-w-0 hidden sm:block">
                      <p className="text-white text-xs font-medium truncate">{photo.name}</p>
                      <p className="text-white/50 text-[10px]">{formatBytes(photo.size)}</p>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={(e) => { e.stopPropagation(); downloadPhoto(photo); }}
                      className={cn(
                        "w-8 h-8 sm:ml-2 rounded-lg flex items-center justify-center shrink-0 transition-all",
                        downloading === photo.url
                          ? "bg-green-500"
                          : "bg-white/20 hover:bg-purple-500/80 backdrop-blur-sm"
                      )}
                    >
                      {downloading === photo.url
                        ? <CheckCircle2 className="w-4 h-4 text-white" />
                        : <Download className="w-4 h-4 text-white" />
                      }
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <div className="border-t border-white/5 py-6 text-center">
        <p className="text-white/20 text-sm flex items-center justify-center gap-1.5">
          Made with <Heart className="w-3.5 h-3.5 text-pink-500 fill-pink-500" /> by Pixmoment
        </p>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/97 flex items-center justify-center"
            onClick={() => setLightbox(null)}
          >
            {/* Close */}
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
              className="absolute top-3 right-3 sm:top-4 sm:right-4 w-9 h-9 sm:w-10 sm:h-10 rounded-xl glass border border-white/10 flex items-center justify-center z-10"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </button>

            {/* Prev — nhỏ hơn trên mobile, nằm dưới ảnh */}
            <button
              onClick={(e) => { e.stopPropagation(); prevPhoto(); }}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-12 sm:h-12 rounded-xl glass border border-white/10 flex items-center justify-center z-10"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </button>

            {/* Next */}
            <button
              onClick={(e) => { e.stopPropagation(); nextPhoto(); }}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-12 sm:h-12 rounded-xl glass border border-white/10 flex items-center justify-center z-10"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </button>

            {/* Image */}
            <motion.div
              key={lightbox}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="relative mx-10 sm:mx-16 max-w-5xl"
            >
              <img
                src={album.photos[lightbox].url}
                alt={album.photos[lightbox].name}
                className="max-w-full max-h-[78vh] sm:max-h-[82vh] object-contain rounded-xl"
              />

              {/* Bottom bar */}
              <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-t from-black/80 rounded-b-xl flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-medium truncate">{album.photos[lightbox].name}</p>
                  <p className="text-white/40 text-[10px] sm:text-xs">{formatBytes(album.photos[lightbox].size)} · {lightbox + 1}/{album.photos.length}</p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => downloadPhoto(album.photos[lightbox])}
                  className="btn-primary px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white flex items-center gap-1.5 shrink-0"
                >
                  <Download className="w-4 h-4" />
                  Tải ảnh gốc
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
