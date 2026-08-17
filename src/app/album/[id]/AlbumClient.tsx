"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, Archive, Heart, ArrowLeft, Lock,
  ImageIcon, Info, X, ChevronLeft, ChevronRight,
  CheckCircle2, Calendar, HardDrive, Eye, Clock,
  Pencil, QrCode, CheckSquare, Square
} from "lucide-react";
import { cn, formatBytes, formatDate } from "@/lib/utils";
import { getOwnerId } from "@/lib/ownerToken";
import { useToast } from "@/components/toast";

interface Photo {
  name: string;
  size: number;
  type: string;
  url: string;
  thumbnailUrl?: string;
}

// Fetches photos with bounded concurrency, yielding each as soon as it
// resolves (order doesn't matter for a zip). Paired with client-zip's
// lazy async-generator consumption, this keeps only `concurrency` photos'
// worth of response bodies in flight/memory at a time, instead of every
// photo in the album at once.
async function* fetchPhotosConcurrently(photos: Photo[], concurrency: number) {
  let cursor = 0;

  function launch(slot: number): Promise<{ slot: number; name: string; input: Response }> | null {
    if (cursor >= photos.length) return null;
    const photo = photos[cursor++];
    return fetch(photo.url).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch ${photo.name}`);
      return { slot, name: photo.name, input: res };
    });
  }

  const slots: (Promise<{ slot: number; name: string; input: Response }> | null)[] = Array.from(
    { length: Math.min(concurrency, photos.length) },
    (_, i) => launch(i)
  );

  while (slots.some(Boolean)) {
    const active = slots.filter((s): s is NonNullable<typeof s> => s !== null);
    const { slot, name, input } = await Promise.race(active);
    slots[slot] = launch(slot);
    yield { name, input };
  }
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

export default function AlbumClient({ id }: { id: string }) {
  const toast = useToast();
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
  const [isOwner, setIsOwner] = useState(false);
  // Selection mode for downloading a chosen subset (not the whole album).
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Data-URL of the share-link QR, generated lazily when the QR panel opens.
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // No browser can decode camera RAW (or other exotic) formats — the file
  // itself is fine (unaffected, still 100% downloadable), but the bare
  // <img> would otherwise collapse to the browser's tiny broken-image icon
  // and wreck the masonry column it sits in. Track which ones failed to
  // decode so those can render a fixed-size placeholder instead.
  const [undecodable, setUndecodable] = useState<Set<string>>(new Set());

  const fetchAlbum = useCallback(async () => {
    setLoading(true);
    try {
      // Pass the ownerId so the creator gets the full album back (and an
      // isOwner flag) without needing to type their own password.
      const res = await fetch(`/api/albums/${id}?ownerId=${getOwnerId()}`);
      const data = await res.json();

      if (res.status === 404) { setError("Không tìm thấy album"); toast("Không tìm thấy album", "error"); setLoading(false); return; }
      if (res.status === 410) { setError("Album đã hết hạn"); toast("Album đã hết hạn", "error"); setLoading(false); return; }

      if (data.isOwner) {
        setIsOwner(true);
        setAlbum(data);
        setLoading(false);
        return;
      }

      if (data.hasPassword) {
        // Remember a successful unlock for this session so a refresh (or an
        // iOS tab reload) doesn't force the password prompt again.
        try {
          const cached = sessionStorage.getItem(`pixmoment_album_${id}`);
          if (cached) {
            setAlbum(JSON.parse(cached));
            setLoading(false);
            return;
          }
        } catch {
          // sessionStorage unavailable (private mode etc.) — just prompt.
        }
        setNeedsPassword(true);
        setLoading(false);
        return;
      }

      setAlbum(data);
      setLoading(false);
    } catch {
      setError("Không tải được album, kiểm tra mạng và thử lại");
      toast("Không tải được album", "error");
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    // Fetch the album on mount / when the id changes — a genuine external-data
    // sync. It flips loading state synchronously on entry, which the rule
    // flags, but that's the intended behaviour for a load-on-mount fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAlbum();
  }, [fetchAlbum]);

  const unlockAlbum = async () => {
    try {
      const res = await fetch(`/api/albums/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.status === 429) {
        // Rate-limited by the brute-force guard — not a wrong password, so
        // don't flag the field red; tell the user to wait.
        const data = await res.json().catch(() => null);
        toast(data?.error ?? "Quá nhiều lần thử, đợi một lát rồi thử lại", "error");
        return;
      }
      if (!res.ok) { setPwError(true); toast("Mật khẩu không đúng", "error"); return; }
      const data = await res.json();
      setAlbum(data);
      setNeedsPassword(false);
      // Remember for this session so a reload doesn't re-prompt.
      try { sessionStorage.setItem(`pixmoment_album_${id}`, JSON.stringify(data)); } catch {}
      toast("Đã mở album", "success");
    } catch {
      toast("Không kết nối được, thử lại", "error");
    }
  };

  const downloadPhoto = async (photo: Photo) => {
    setDownloading(photo.url);
    try {
      const res = await fetch(photo.url);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = photo.name;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Đã tải ${photo.name}`, "success");
    } catch {
      toast(`Tải ${photo.name} thất bại, thử lại`, "error");
    } finally {
      setTimeout(() => setDownloading(null), 1000);
    }
  };

  const zipPhotos = async (photos: Photo[], filename: string) => {
    if (photos.length === 0) return;
    setZipping(true);
    try {
      // client-zip streams each input straight into the zip output as it
      // arrives — unlike JSZip (which buffers every file before it can
      // generate anything), memory stays roughly constant regardless of
      // album size instead of holding every original-quality photo at
      // once. fetchPhotosConcurrently bounds how many are being fetched at
      // a time so we're not opening 100-200 connections simultaneously either.
      const { downloadZip } = await import("client-zip");
      const response = downloadZip(fetchPhotosConcurrently(photos, 4));
      const content = await response.blob();
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setZipDone(true);
      toast("Đã tải ZIP", "success");
      setTimeout(() => setZipDone(false), 3000);
    } catch {
      toast("Nén ZIP thất bại, thử lại", "error");
    } finally {
      setZipping(false);
    }
  };

  const downloadAllAsZip = () => {
    if (!album) return;
    zipPhotos(album.photos, `${album.title}.zip`);
  };

  const downloadSelectedAsZip = () => {
    if (!album || selected.size === 0) return;
    const picked = album.photos.filter((_, i) => selected.has(i));
    zipPhotos(picked, `${album.title} (${picked.length} ảnh).zip`);
  };

  const toggleSelecting = () => {
    setSelecting((on) => !on);
    setSelected(new Set());
  };

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/album/${id}` : "";

  const openQr = async () => {
    try {
      const dataUrl = await QRCode.toDataURL(shareUrl, { width: 320, margin: 1 });
      setQrDataUrl(dataUrl);
    } catch {
      toast("Không tạo được mã QR", "error");
    }
  };

  // In selection mode a tile toggles its checkbox; otherwise it opens the lightbox.
  const handleTileClick = (i: number) => {
    if (selecting) toggleSelect(i);
    else setLightbox(i);
  };

  const prevPhoto = useCallback(() => {
    setLightbox((current) => {
      if (current === null || !album) return current;
      return (current - 1 + album.photos.length) % album.photos.length;
    });
  }, [album]);

  const nextPhoto = useCallback(() => {
    setLightbox((current) => {
      if (current === null || !album) return current;
      return (current + 1) % album.photos.length;
    });
  }, [album]);

  useEffect(() => {
    if (lightbox === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowLeft") prevPhoto();
      else if (e.key === "ArrowRight") nextPhoto();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox, prevPhoto, nextPhoto]);

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
          <Link href="/" className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Tạo album mới
          </Link>
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
                "w-full bg-white/5 border rounded-xl px-4 py-3 text-base text-white placeholder-white/30 focus:outline-none transition-colors",
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
          <Link href="/" className="w-9 h-9 rounded-xl glass border border-white/10 flex items-center justify-center hover:border-purple-400/30 transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </Link>

          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-white truncate text-sm sm:text-base">{album.title}</h1>
            <p className="text-xs text-white/30 truncate">
              {album.photos.length} ảnh · {formatBytes(album.totalSize)}
              <span className="hidden sm:inline"> · {formatDate(new Date(album.createdAt))}</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {isOwner && (
              <Link
                href={`/album/${id}/edit`}
                title="Sửa album"
                className="w-9 h-9 rounded-xl glass border border-white/10 flex items-center justify-center hover:border-purple-400/30 transition-colors"
              >
                <Pencil className="w-4 h-4 text-white/60" />
              </Link>
            )}
            <button
              onClick={openQr}
              title="Mã QR"
              className="w-9 h-9 rounded-xl glass border border-white/10 flex items-center justify-center hover:border-purple-400/30 transition-colors"
            >
              <QrCode className="w-4 h-4 text-white/60" />
            </button>
            <button
              onClick={toggleSelecting}
              title="Chọn ảnh để tải"
              className={cn(
                "w-9 h-9 rounded-xl glass border flex items-center justify-center transition-colors",
                selecting ? "border-purple-400/60 text-purple-300" : "border-white/10 text-white/60 hover:border-purple-400/30"
              )}
            >
              <CheckSquare className="w-4 h-4" />
            </button>
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {[
                  { icon: ImageIcon, label: "Số ảnh", value: `${album.photos.length} ảnh` },
                  { icon: HardDrive, label: "Tổng dung lượng", value: formatBytes(album.totalSize) },
                  { icon: Calendar, label: "Ngày tạo", value: formatDate(new Date(album.createdAt)) },
                  { icon: Clock, label: "Hết hạn", value: album.expiresAt ? formatDate(new Date(album.expiresAt)) : "Không hết hạn" },
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
              transition={{ delay: Math.min(i * 0.04, 0.5), duration: 0.4 }}
              className="masonry-item"
            >
              <div className={cn(
                "photo-card group relative rounded-xl overflow-hidden bg-white/5 cursor-pointer",
                selecting && selected.has(i) && "ring-2 ring-purple-400"
              )}>
                {selecting && (
                  <div className="absolute top-1.5 left-1.5 z-20 pointer-events-none">
                    {selected.has(i)
                      ? <CheckSquare className="w-5 h-5 text-purple-300" />
                      : <Square className="w-5 h-5 text-white/70 drop-shadow" />}
                  </div>
                )}
                {undecodable.has(photo.url) ? (
                  <div
                    onClick={() => handleTileClick(i)}
                    className="w-full aspect-square flex flex-col items-center justify-center gap-2 px-3 text-center"
                  >
                    <ImageIcon className="w-7 h-7 text-white/20" />
                    <p className="text-white/40 text-xs truncate w-full">{photo.name}</p>
                  </div>
                ) : (
                  // Grid shows the small uploaded thumbnail, not the full-res
                  // original — an album of 100+ photos would otherwise download
                  // hundreds of MB just to render the lattice. Falls back to the
                  // original when a thumbnail is missing (e.g. HEIC, which can't
                  // be thumbnailed off-Safari — and also can't be decoded here,
                  // so onError promotes it to the placeholder). The lightbox and
                  // downloads always use the original url.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.thumbnailUrl ?? photo.url}
                    alt={photo.name}
                    className="w-full h-auto block"
                    onClick={() => handleTileClick(i)}
                    onError={() => setUndecodable((prev) => new Set(prev).add(photo.url))}
                    loading="lazy"
                  />
                )}

                {/* Overlay — always visible on mobile (no hover), hover on desktop.
                    pointer-events must mirror opacity: an invisible-but-interactive
                    overlay silently blocks clicks meant for the photo underneath
                    (opacity alone doesn't disable hit-testing). It also needs its
                    own onClick mirroring the image's — while hovering (the normal
                    precursor to any real click), this overlay covers the whole
                    photo, so without this a click anywhere except the tiny
                    download button would hit the overlay and silently do nothing
                    instead of opening the lightbox. */}
                <div
                  onClick={() => handleTileClick(i)}
                  className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 pointer-events-auto sm:pointer-events-none sm:group-hover:pointer-events-auto transition-all duration-300">
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
      <div className={cn("border-t border-white/5 py-6 text-center", selecting && "pb-24")}>
        <p className="text-white/20 text-sm flex items-center justify-center gap-1.5">
          Made with <Heart className="w-3.5 h-3.5 text-pink-500 fill-pink-500" /> by Pixmoment
        </p>
      </div>

      {/* Selection action bar */}
      <AnimatePresence>
        {selecting && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 glass"
          >
            <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
              <span className="text-sm text-white/70">{selected.size} ảnh đã chọn</span>
              <button
                onClick={() => setSelected(new Set(album.photos.map((_, i) => i)))}
                className="text-xs text-white/50 hover:text-white/80"
              >
                Chọn hết
              </button>
              {selected.size > 0 && (
                <button onClick={() => setSelected(new Set())} className="text-xs text-white/50 hover:text-white/80">
                  Bỏ chọn
                </button>
              )}
              <div className="flex-1" />
              <button onClick={toggleSelecting} className="px-3 py-2 rounded-xl text-sm text-white/50 border border-white/10 hover:text-white/70">
                Xong
              </button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={downloadSelectedAsZip}
                disabled={selected.size === 0 || zipping}
                className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50"
              >
                <Archive className="w-4 h-4" />
                Tải {selected.size > 0 ? `${selected.size} ảnh` : "ZIP"}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR modal */}
      <AnimatePresence>
        {qrDataUrl && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setQrDataUrl(null)}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4"
          >
            <motion.div
              initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="glass rounded-2xl p-6 space-y-4 text-center max-w-xs w-full"
            >
              <h3 className="font-semibold text-white">Quét để mở album</h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR code" className="w-full rounded-xl bg-white p-2" />
              <p className="text-xs text-white/40 break-all">{shareUrl}</p>
              <button onClick={() => setQrDataUrl(null)} className="btn-primary w-full py-2.5 rounded-xl text-sm font-semibold text-white">
                Đóng
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              {undecodable.has(album.photos[lightbox].url) ? (
                <div className="w-[80vw] max-w-md aspect-square flex flex-col items-center justify-center gap-3 glass rounded-xl">
                  <ImageIcon className="w-10 h-10 text-white/20" />
                  <p className="text-white/50 text-sm px-4 text-center truncate w-full">{album.photos[lightbox].name}</p>
                  <p className="text-white/30 text-xs">Trình duyệt không xem trước được định dạng này — tải về để xem</p>
                </div>
              ) : (
                <img
                  src={album.photos[lightbox].url}
                  alt={album.photos[lightbox].name}
                  className="max-w-full max-h-[78vh] sm:max-h-[82vh] object-contain rounded-xl"
                  onError={() => setUndecodable((prev) => new Set(prev).add(album.photos[lightbox].url))}
                />
              )}

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
