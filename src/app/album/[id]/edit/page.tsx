"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Lock, Clock, Star, Trash2, ChevronLeft, ChevronRight,
  Plus, Save, Loader2, ImageIcon, X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { cn, formatBytes, createThumbnailBlob } from "@/lib/utils";
import { uploadPhoto, uploadThumbnail } from "@/lib/uploadQueue";
import { getOwnerId } from "@/lib/ownerToken";
import { useToast } from "@/components/toast";
import { RAW_EXTENSIONS } from "@/lib/rawPhotoTypes";

interface Photo {
  name: string;
  size: number;
  type: string;
  url: string;
  thumbnailUrl?: string;
}

// How many originals+thumbnails to upload at once when adding photos in the
// editor — small, since edit-time additions are typically a handful.
const ADD_CONCURRENCY = 3;

export default function AlbumEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [title, setTitle] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [hasPassword, setHasPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  // "keep" leaves the current expiry untouched; any other value re-bases it.
  const [expiryChoice, setExpiryChoice] = useState<"keep" | "never" | "1d" | "7d" | "30d">("keep");
  const [adding, setAdding] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/albums/${id}?ownerId=${getOwnerId()}`);
        const data = await res.json();
        // Only the owner gets photos back; anyone else can't edit.
        if (!res.ok || !data.isOwner) {
          setDenied(true);
          return;
        }
        setTitle(data.title ?? "");
        setPhotos(Array.isArray(data.photos) ? data.photos : []);
        setHasPassword(!!data.hasPassword);
      } catch {
        setDenied(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const movePhoto = (index: number, dir: -1 | 1) => {
    setPhotos((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const setCover = (index: number) => {
    setPhotos((prev) => {
      if (index === 0) return prev;
      const next = [...prev];
      const [picked] = next.splice(index, 1);
      return [picked, ...next];
    });
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length === 0) return;
    setAdding((n) => n + accepted.length);

    let cursor = 0;
    const worker = async () => {
      while (cursor < accepted.length) {
        const file = accepted[cursor++];
        const pid = nanoid();
        // Upload the original and build+upload the thumbnail in parallel.
        const [orig, thumbBlob] = await Promise.all([
          uploadPhoto(pid, file),
          createThumbnailBlob(file),
        ]);
        if (orig) {
          const thumbnailUrl = thumbBlob ? (await uploadThumbnail(pid, thumbBlob)) ?? undefined : undefined;
          setPhotos((prev) => [
            ...prev,
            { name: file.name, size: orig.size, type: orig.contentType, url: orig.url, thumbnailUrl },
          ]);
        } else {
          toast(`Tải ${file.name} thất bại`, "error");
        }
        setAdding((n) => n - 1);
      }
    };
    for (let i = 0; i < ADD_CONCURRENCY; i++) worker();
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg", ".avif",
        ...RAW_EXTENSIONS,
      ],
      "image/heic": [".heic"],
      "image/heif": [".heif"],
    },
    multiple: true,
  });

  const save = async () => {
    if (photos.length === 0) {
      toast("Album phải có ít nhất 1 ảnh", "error");
      return;
    }
    if (adding > 0) {
      toast("Đợi ảnh thêm upload xong đã", "info");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/albums/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId: getOwnerId(),
          title: title || undefined,
          photos,
          ...(removePassword
            ? { removePassword: true }
            : newPassword
              ? { password: newPassword }
              : {}),
          ...(expiryChoice !== "keep" ? { expiresIn: expiryChoice } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(data?.error ?? "Lưu thất bại, thử lại", "error");
        return;
      }
      // Hand the just-saved album to the view so it shows instantly, ahead of
      // Blob's ~15s overwrite propagation (see AlbumClient).
      try {
        const saved = await res.json();
        sessionStorage.setItem(`pixmoment_fresh_${id}`, JSON.stringify(saved));
      } catch {
        // Non-fatal — the view will just read from the API instead.
      }
      toast("Đã lưu album", "success");
      router.push(`/album/${id}`);
    } catch {
      toast("Không kết nối được, thử lại", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (denied) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] bg-mesh flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="text-5xl">🔒</div>
          <h1 className="text-xl font-bold text-white">Không thể sửa album này</h1>
          <p className="text-white/40 text-sm max-w-xs mx-auto">
            Chỉ người tạo album (trên đúng trình duyệt/thiết bị đã tạo) mới sửa được.
          </p>
          <Link href={`/album/${id}`} className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Về album
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] bg-mesh pb-28">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/5 glass">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href={`/album/${id}`} className="w-9 h-9 rounded-xl glass border border-white/10 flex items-center justify-center hover:border-purple-400/30 transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </Link>
          <h1 className="flex-1 font-bold text-white truncate">Sửa album</h1>
          <span className="text-xs text-white/40">{photos.length} ảnh</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Settings */}
        <div className="glass rounded-2xl p-5 space-y-4">
          <input
            type="text"
            placeholder="Tên album"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-base text-white placeholder-white/25 focus:outline-none focus:border-purple-400/50 transition-colors"
          />

          {/* Password */}
          <div className="space-y-2">
            {hasPassword && !removePassword && (
              <p className="text-xs text-white/40">Album đang có mật khẩu. Để trống để giữ nguyên, hoặc nhập mật khẩu mới để đổi.</p>
            )}
            {!removePassword && (
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-purple-400 shrink-0" />
                <input
                  type="password"
                  placeholder={hasPassword ? "Mật khẩu mới (để trống = giữ)" : "Đặt mật khẩu (để trống = không)"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-base text-white placeholder-white/25 focus:outline-none focus:border-purple-400/50 transition-colors"
                />
              </div>
            )}
            {hasPassword && (
              <label className="flex items-center gap-2 text-sm text-white/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={removePassword}
                  onChange={(e) => { setRemovePassword(e.target.checked); if (e.target.checked) setNewPassword(""); }}
                  className="accent-purple-500"
                />
                Bỏ mật khẩu (ai có link đều xem được)
              </label>
            )}
          </div>

          {/* Expiry */}
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 w-fit">
            <Clock className="w-3.5 h-3.5 text-white/30" />
            <select
              value={expiryChoice}
              onChange={(e) => setExpiryChoice(e.target.value as typeof expiryChoice)}
              className="bg-transparent text-sm text-white/60 focus:outline-none cursor-pointer"
            >
              <option value="keep" style={{ background: "#1a1a2e" }}>Giữ hạn hiện tại</option>
              <option value="never" style={{ background: "#1a1a2e" }}>Không hết hạn</option>
              <option value="1d" style={{ background: "#1a1a2e" }}>Hết hạn sau 1 ngày</option>
              <option value="7d" style={{ background: "#1a1a2e" }}>Hết hạn sau 7 ngày</option>
              <option value="30d" style={{ background: "#1a1a2e" }}>Hết hạn sau 30 ngày</option>
            </select>
          </div>
        </div>

        {/* Photos */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((photo, i) => (
            <div key={photo.url} className="relative group aspect-square rounded-xl overflow-hidden bg-white/5">
              {photo.thumbnailUrl ?? photo.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.thumbnailUrl ?? photo.url} alt={photo.name} loading="lazy" className="w-full h-full object-cover" />
              ) : null}
              {i === 0 && (
                <span className="absolute top-1 left-1 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/80 text-white flex items-center gap-0.5">
                  <Star className="w-2.5 h-2.5 fill-white" /> Bìa
                </span>
              )}
              {/* Controls */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                <div className="flex items-center gap-1">
                  <button onClick={() => movePhoto(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center disabled:opacity-30">
                    <ChevronLeft className="w-4 h-4 text-white" />
                  </button>
                  <button onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1} className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center disabled:opacity-30">
                    <ChevronRight className="w-4 h-4 text-white" />
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCover(i)} disabled={i === 0} title="Đặt làm bìa" className="w-7 h-7 rounded-lg bg-white/15 hover:bg-purple-500/60 flex items-center justify-center disabled:opacity-30">
                    <Star className="w-4 h-4 text-white" />
                  </button>
                  <button onClick={() => removePhoto(i)} title="Xoá ảnh" className="w-7 h-7 rounded-lg bg-white/15 hover:bg-red-500/60 flex items-center justify-center">
                    <Trash2 className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
              {/* Always-visible controls on touch (no hover) */}
              <button onClick={() => removePhoto(i)} className="sm:hidden absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center">
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          ))}

          {/* Add tile */}
          <div {...getRootProps()} className={cn("aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors gap-1", isDragActive ? "border-purple-400/60 bg-purple-500/5" : "border-white/10 hover:border-purple-400/40")}>
            <input {...getInputProps()} />
            {adding > 0 ? (
              <>
                <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                <span className="text-white/40 text-[10px]">+{adding}</span>
              </>
            ) : (
              <>
                <Plus className="w-6 h-6 text-white/25" />
                <span className="text-white/30 text-[10px]">Thêm ảnh</span>
              </>
            )}
          </div>
        </div>

        {photos.length === 0 && (
          <p className="text-center text-white/30 text-sm flex items-center justify-center gap-2">
            <ImageIcon className="w-4 h-4" /> Album trống — thêm ít nhất 1 ảnh trước khi lưu.
          </p>
        )}
      </main>

      {/* Save bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/5 glass">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href={`/album/${id}`} className="px-4 py-2.5 rounded-xl text-sm text-white/50 border border-white/10 hover:text-white/70 transition-colors">
            Huỷ
          </Link>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={save}
            disabled={saving || adding > 0}
            className="btn-primary flex-1 py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </motion.button>
        </div>
      </div>
      <AnimatePresence />
    </div>
  );
}
