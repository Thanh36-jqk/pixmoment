"use client";

import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, ImageIcon, Sparkles, Lock, Clock, ArrowRight,
  CheckCircle2, X, FileImage, Loader2, Heart, Smartphone, Download
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { nanoid } from "nanoid";

interface FileItem {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  url?: string;
}

export default function HomePage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [expiry, setExpiry] = useState("never");
  const [uploading, setUploading] = useState(false);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [step, setStep] = useState<"upload" | "uploading" | "done">("upload");
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as Record<string,unknown>).MSStream;
    setIsIOS(ios);
  }, []);
  const [copied, setCopied] = useState(false);

  const onDrop = useCallback((accepted: File[]) => {
    const newItems: FileItem[] = accepted.map((file) => ({
      id: nanoid(),
      file,
      preview: URL.createObjectURL(file),
      status: "pending",
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...newItems]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: true,
  });

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setStep("uploading");

    const uploadedPhotos: { name: string; size: number; type: string; url: string }[] = [];

    for (const item of files) {
      setFiles((prev) =>
        prev.map((f) => f.id === item.id ? { ...f, status: "uploading" } : f)
      );

      try {
        const formData = new FormData();
        formData.append("file", item.file);

        const interval = setInterval(() => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id && f.progress < 85
                ? { ...f, progress: f.progress + 15 }
                : f
            )
          );
        }, 300);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        clearInterval(interval);

        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();

        uploadedPhotos.push({
          name: item.file.name,
          size: item.file.size,
          type: item.file.type,
          url: data.url,
        });

        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id ? { ...f, status: "done", progress: 100, url: data.url } : f
          )
        );
      } catch {
        setFiles((prev) =>
          prev.map((f) => f.id === item.id ? { ...f, status: "error" } : f)
        );
      }
    }

    const albumRes = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title || "Album của chúng mình",
        photos: uploadedPhotos,
        password: usePassword ? password : undefined,
        expiresIn: expiry,
      }),
    });

    const album = await albumRes.json();
    setAlbumId(album.id);
    setUploading(false);
    setStep("done");
  };

  const shareUrl = typeof window !== "undefined" && albumId
    ? `${window.location.origin}/album/${albumId}`
    : "";

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalSize = files.reduce((acc, f) => acc + f.file.size, 0);
  const doneCount = files.filter(f => f.status === "done").length;

  return (
    <div className="min-h-screen bg-mesh relative overflow-hidden">
      {/* Ambient blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-purple-600/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-pink-600/10 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-purple-900/5 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-white/5">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2.5"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Heart className="w-4.5 h-4.5 text-white fill-white" />
          </div>
          <span className="font-bold text-xl gradient-text tracking-tight">Pixmoment</span>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="hidden sm:flex items-center gap-4 text-white/30 text-sm"
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Ảnh gốc 100%
          </span>
        </motion.div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-6 sm:py-12">
        <AnimatePresence mode="wait">

          {/* ─── STEP: UPLOAD ─── */}
          {step === "upload" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.4 }}
              className="space-y-8"
            >
              {/* iOS banner */}
              <AnimatePresence>
                {isIOS && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 flex items-start gap-3"
                  >
                    <Smartphone className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-amber-300">Bạn đang dùng iPhone</p>
                      <p className="text-xs text-amber-400/70 mt-0.5">
                        Safari sẽ convert ảnh HEIC → JPEG khi upload. Dùng <strong>iOS Shortcut</strong> để giữ 100% chất lượng gốc.
                      </p>
                      <button
                        onClick={() => setShowIOSGuide(true)}
                        className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Tải Shortcut miễn phí →
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Hero text */}
              <div className="text-center space-y-3 pt-2">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-xs sm:text-sm text-purple-300 border border-purple-500/20"
                >
                  <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  Không nén · Không resize · Không mất chất lượng
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="text-3xl sm:text-5xl font-bold leading-tight"
                >
                  Gửi ảnh cho <span className="gradient-text">người yêu</span>
                  <br className="hidden sm:block" />
                  {" "}không mất một pixel
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-white/40 text-sm sm:text-base max-w-md mx-auto px-2"
                >
                  Upload ảnh · tạo link · người kia tải về file gốc 100%
                </motion.p>
              </div>

              {/* Dropzone */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
              >
                <div
                  {...getRootProps()}
                  className={cn("upload-zone rounded-2xl p-8 sm:p-14 text-center cursor-pointer select-none", isDragActive && "active")}
                >
                  <input {...getInputProps()} />
                  <motion.div animate={{ scale: isDragActive ? 1.08 : 1 }} className="space-y-4">
                    <div className="relative w-16 h-16 sm:w-20 sm:h-20 mx-auto">
                      <div className="absolute inset-0 rounded-2xl bg-purple-500/20 blur-xl" />
                      <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl glass border border-purple-400/20 flex items-center justify-center">
                        <Upload className="w-7 h-7 sm:w-9 sm:h-9 text-purple-400" />
                      </div>
                    </div>
                    <div>
                      <p className="text-base sm:text-lg font-semibold text-white/90">
                        {isDragActive ? "Thả ảnh vào đây ✨" : "Nhấn để chọn ảnh"}
                      </p>
                      <p className="text-white/40 text-xs sm:text-sm mt-1.5">
                        <span className="hidden sm:inline">hoặc kéo thả vào đây · </span>
                        JPEG · PNG · HEIC · RAW · GIF
                      </p>
                    </div>
                  </motion.div>
                </div>
              </motion.div>

              {/* File list */}
              <AnimatePresence>
                {files.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-5"
                  >
                    {/* Stats bar */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white/50">
                        <span className="text-white font-semibold">{files.length}</span> ảnh ·{" "}
                        <span className="text-white font-semibold">{formatBytes(totalSize)}</span>
                      </span>
                      <button
                        onClick={() => setFiles([])}
                        className="text-white/30 hover:text-red-400 transition-colors text-xs"
                      >
                        Xóa tất cả
                      </button>
                    </div>

                    {/* Grid */}
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {files.map((item, i) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ delay: i * 0.04 }}
                          className="photo-card relative group aspect-square rounded-xl overflow-hidden bg-white/5"
                        >
                          <img src={item.preview} alt={item.file.name} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                          <button
                            onClick={() => removeFile(item.id)}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                          <div className="absolute bottom-1 left-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <p className="text-white text-[8px] truncate">{formatBytes(item.file.size)}</p>
                          </div>
                        </motion.div>
                      ))}

                      {/* Add more button */}
                      <div {...getRootProps()} className="aspect-square rounded-xl border-2 border-dashed border-white/10 hover:border-purple-400/40 flex items-center justify-center cursor-pointer transition-colors">
                        <input {...getInputProps()} />
                        <span className="text-white/20 text-2xl">+</span>
                      </div>
                    </div>

                    {/* Album settings */}
                    <div className="glass rounded-2xl p-5 space-y-4">
                      <h3 className="text-sm font-semibold text-white/60 flex items-center gap-2 uppercase tracking-wider">
                        <FileImage className="w-3.5 h-3.5 text-purple-400" />
                        Tùy chọn album
                      </h3>

                      <input
                        type="text"
                        placeholder="Tên album • vd: Ngày hẹn hò 07/06 🌸"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-purple-400/50 transition-colors"
                      />

                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => setUsePassword(!usePassword)}
                          className={cn(
                            "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border transition-all font-medium",
                            usePassword
                              ? "bg-purple-500/20 border-purple-400/40 text-purple-300"
                              : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"
                          )}
                        >
                          <Lock className="w-3.5 h-3.5" />
                          {usePassword ? "Có mật khẩu" : "Đặt mật khẩu"}
                        </button>

                        <AnimatePresence>
                          {usePassword && (
                            <motion.input
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -10 }}
                              type="password"
                              placeholder="Nhập mật khẩu..."
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              className="flex-1 min-w-32 bg-white/5 border border-purple-400/30 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-purple-400/60 transition-colors"
                            />
                          )}
                        </AnimatePresence>

                        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10">
                          <Clock className="w-3.5 h-3.5 text-white/30" />
                          <select
                            value={expiry}
                            onChange={(e) => setExpiry(e.target.value)}
                            className="bg-transparent text-sm text-white/50 focus:outline-none cursor-pointer"
                          >
                            <option value="never" style={{background:"#1a1a2e"}}>Không hết hạn</option>
                            <option value="1d" style={{background:"#1a1a2e"}}>Hết hạn sau 1 ngày</option>
                            <option value="7d" style={{background:"#1a1a2e"}}>Hết hạn sau 7 ngày</option>
                            <option value="30d" style={{background:"#1a1a2e"}}>Hết hạn sau 30 ngày</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Upload button */}
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleUpload}
                      className="btn-primary w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-3 text-base shadow-2xl shadow-purple-500/20"
                    >
                      <Upload className="w-5 h-5" />
                      Tạo album · {files.length} ảnh · {formatBytes(totalSize)}
                      <ArrowRight className="w-5 h-5" />
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Feature pills */}
              {files.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="grid grid-cols-3 gap-2"
                >
                  {[
                    { emoji: "🔒", label: "Ảnh gốc 100%" },
                    { emoji: "📦", label: "Tải ZIP" },
                    { emoji: "🔐", label: "Mật khẩu" },
                    { emoji: "⏰", label: "Hết hạn" },
                    { emoji: "📱", label: "iOS/Android" },
                    { emoji: "⚡", label: "Siêu nhanh" },
                  ].map((f) => (
                    <span key={f.label} className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl glass text-xs text-white/40">
                      {f.emoji} {f.label}
                    </span>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ─── STEP: UPLOADING ─── */}
          {step === "uploading" && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-400/20 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                </div>
                <h2 className="text-2xl font-bold">Đang upload...</h2>
                <p className="text-white/40 text-sm">
                  {doneCount}/{files.length} ảnh hoàn tất — giữ nguyên chất lượng gốc
                </p>
                {/* Overall progress */}
                <div className="w-full max-w-xs mx-auto h-1 bg-white/10 rounded-full overflow-hidden mt-4">
                  <motion.div
                    animate={{ width: `${files.length ? (doneCount / files.length) * 100 : 0}%` }}
                    className="h-full progress-shimmer rounded-full"
                  />
                </div>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {files.map((item) => (
                  <div key={item.id} className="glass rounded-xl p-3.5 flex items-center gap-3">
                    <img src={item.preview} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-white/80">{item.file.name}</p>
                      <p className="text-xs text-white/30">{formatBytes(item.file.size)}</p>
                      {item.status === "uploading" && (
                        <div className="mt-1.5 h-1 bg-white/10 rounded-full overflow-hidden">
                          <motion.div
                            animate={{ width: `${item.progress}%` }}
                            className="h-full progress-shimmer rounded-full"
                          />
                        </div>
                      )}
                    </div>
                    <div className="shrink-0">
                      {item.status === "done" && <CheckCircle2 className="w-5 h-5 text-green-400" />}
                      {item.status === "uploading" && <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />}
                      {item.status === "error" && <X className="w-5 h-5 text-red-400" />}
                      {item.status === "pending" && <div className="w-4 h-4 rounded-full border-2 border-white/20" />}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ─── STEP: DONE ─── */}
          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="space-y-8 text-center"
            >
              <motion.div
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", delay: 0.1, stiffness: 200 }}
                className="relative w-24 h-24 mx-auto"
              >
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-purple-500 to-pink-500 blur-xl opacity-50" />
                <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center">
                  <CheckCircle2 className="w-12 h-12 text-white" />
                </div>
              </motion.div>

              <div>
                <h2 className="text-3xl font-bold">Album sẵn sàng! 🎉</h2>
                <p className="text-white/40 mt-2">
                  {files.filter(f => f.status === "done").length} ảnh · {formatBytes(totalSize)} · chất lượng gốc 100%
                </p>
              </div>

              <div className="glass rounded-2xl p-6 space-y-3 text-left max-w-md mx-auto">
                <p className="text-xs text-white/40 uppercase tracking-wider text-center">Link chia sẻ</p>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 bg-black/30 rounded-xl px-4 py-3 text-sm text-purple-300 font-mono truncate border border-purple-500/20">
                    {shareUrl}
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={copyLink}
                    className={cn(
                      "px-4 rounded-xl text-sm font-semibold text-white transition-all shrink-0",
                      copied ? "bg-green-500" : "btn-primary"
                    )}
                  >
                    {copied ? "✓ Đã copy" : "Copy"}
                  </motion.button>
                </div>
                <p className="text-xs text-white/25 text-center">
                  Gửi link này qua bất kỳ app nào — người nhận tải về file gốc
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <motion.a
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  href={`/album/${albumId}`}
                  className="btn-primary px-8 py-3.5 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
                >
                  <ImageIcon className="w-4 h-4" />
                  Xem album
                </motion.a>
                <button
                  onClick={() => { setFiles([]); setAlbumId(null); setStep("upload"); setTitle(""); }}
                  className="px-8 py-3.5 rounded-xl font-semibold text-white/50 border border-white/10 hover:border-white/20 hover:text-white/70 transition-all"
                >
                  Tạo album mới
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* iOS Shortcut Guide Modal */}
      <AnimatePresence>
        {showIOSGuide && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="glass rounded-3xl p-6 w-full max-w-md space-y-5"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">iOS Shortcut</h3>
                    <p className="text-xs text-white/40">Giữ 100% chất lượng HEIC gốc</p>
                  </div>
                </div>
                <button onClick={() => setShowIOSGuide(false)} className="w-8 h-8 rounded-lg glass flex items-center justify-center">
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>

              {/* Why */}
              <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl p-3 text-xs text-amber-300/80 leading-relaxed">
                <strong className="text-amber-300">Tại sao cần Shortcut?</strong> Safari tự convert HEIC → JPEG khi chọn từ thư viện ảnh.
                iOS Shortcuts truy cập trực tiếp file gốc, không qua browser — giữ nguyên HEIC 100%.
              </div>

              {/* Steps */}
              <div className="space-y-3">
                {[
                  { n: "1", text: "Tải file Shortcut về iPhone", sub: "Nhấn nút bên dưới, Safari tự mở Shortcuts app" },
                  { n: "2", text: "Nhấn \"Add Shortcut\"", sub: "Shortcut tên \"Pixmoment Upload\" sẽ được thêm vào" },
                  { n: "3", text: "Mở Shortcuts → chạy Pixmoment Upload", sub: "Chọn ảnh → đặt tên album → link tự copy vào clipboard" },
                  { n: "4", text: "Gửi link cho người yêu 💕", sub: "Qua Zalo, Messenger, SMS — bất kỳ app nào" },
                ].map(s => (
                  <div key={s.n} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-white">{s.n}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{s.text}</p>
                      <p className="text-xs text-white/40">{s.sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Download button */}
              <a
                href="/PixmomentUpload.shortcut"
                download="PixmomentUpload.shortcut"
                className="btn-primary w-full py-3.5 rounded-xl font-bold text-white flex items-center justify-center gap-2 text-sm"
              >
                <Download className="w-4 h-4" />
                Tải iOS Shortcut (miễn phí)
              </a>

              <p className="text-center text-xs text-white/25">
                Yêu cầu iOS 16+ · Shortcuts app (cài sẵn trên iPhone)
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
