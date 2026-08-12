"use client";

import { useState, useCallback, useEffect, useRef, memo } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, ImageIcon, Sparkles, Lock, Clock, ArrowRight,
  CheckCircle2, X, FileImage, Loader2, Heart, Smartphone, AlertTriangle
} from "lucide-react";
import { cn, formatBytes, createThumbnail } from "@/lib/utils";
import { UploadManager, type UploadTask } from "@/lib/uploadQueue";
import { useToast } from "@/components/toast";
import { getOwnerId } from "@/lib/ownerToken";
import { RAW_EXTENSIONS } from "@/lib/rawPhotoTypes";
import { nanoid } from "nanoid";

interface FileItem {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  url?: string;
  error?: string;
}

interface PhotoGridItemProps {
  id: string;
  preview: string;
  fileName: string;
  fileSize: number;
  status: FileItem["status"];
  index: number;
  onRemove: (id: string) => void;
}

// Memoized so a progress-only update to ONE file (which fires several
// times a second per file while uploading) doesn't force React to
// reconcile all 100-200 grid tiles — only the tile whose own props
// actually changed re-renders. Depends on removeFile being a stable
// (useCallback'd) reference and on `progress` NOT being passed as a prop
// here, since it's not actually displayed in this tile.
const PhotoGridItem = memo(function PhotoGridItem({
  id,
  preview,
  fileName,
  fileSize,
  status,
  index,
  onRemove,
}: PhotoGridItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={{ delay: Math.min(index * 0.04, 0.5) }}
      className="photo-card relative group aspect-square rounded-xl overflow-hidden bg-white/5"
    >
      {preview ? (
        <img src={preview} alt={fileName} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : (
        // No client-side preview available (e.g. HEIC on Chrome/Android,
        // which has no decoder for it) — still show something rather than
        // an empty tile, which otherwise reads as broken/stuck. The file
        // itself uploads fine regardless; only the thumbnail is missing.
        <div className="w-full h-full flex items-center justify-center">
          <FileImage className="w-5 h-5 text-white/20" />
        </div>
      )}
      {status === "uploading" && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="w-4 h-4 text-white animate-spin" />
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 bg-red-900/50 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4 text-red-200" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent opacity-0 sm:group-hover:opacity-100 transition-opacity" />
      {/* Always visible on touch devices — :hover doesn't reliably reveal these on mobile */}
      <button
        onClick={() => onRemove(id)}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 pointer-events-auto sm:pointer-events-none sm:group-hover:pointer-events-auto transition-opacity"
      >
        <X className="w-3.5 h-3.5 text-white" />
      </button>
      <div className="absolute bottom-1 left-1 right-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <p className="text-white text-[8px] truncate bg-black/50 rounded px-1">{formatBytes(fileSize)}</p>
      </div>
    </motion.div>
  );
});

interface UploadingRowProps {
  preview: string;
  fileName: string;
  fileSize: number;
  status: FileItem["status"];
  progress: number;
}

// Same reasoning as PhotoGridItem above — this list is visible while
// uploads are still settling (e.g. the user clicked "Tạo album" before a
// large batch finished), and each row's own progress ticks several times
// a second. Memoized so only the row whose progress actually changed
// re-renders instead of all 100-200.
const UploadingRow = memo(function UploadingRow({ preview, fileName, fileSize, status, progress }: UploadingRowProps) {
  return (
    <div className="glass rounded-xl p-3.5 flex items-center gap-3">
      {preview ? (
        <img src={preview} alt="" loading="lazy" decoding="async" className="w-10 h-10 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-white/5 shrink-0 flex items-center justify-center">
          <FileImage className="w-4 h-4 text-white/20" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-white/80">{fileName}</p>
        <p className="text-xs text-white/30">{formatBytes(fileSize)}</p>
        {status === "uploading" && (
          <div className="mt-1.5 h-1 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              animate={{ width: `${progress}%` }}
              className="h-full progress-shimmer rounded-full"
            />
          </div>
        )}
      </div>
      <div className="shrink-0">
        {status === "done" && <CheckCircle2 className="w-5 h-5 text-green-400" />}
        {status === "uploading" && <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />}
        {status === "error" && <X className="w-5 h-5 text-red-400" />}
        {status === "pending" && <div className="w-4 h-4 rounded-full border-2 border-white/20" />}
      </div>
    </div>
  );
});

interface VirtualRange {
  start: number;
  end: number;
}

// A `useRef` object's identity never changes even after the DOM node it
// points at mounts, so effects keyed on the ref object itself (rather than
// its `.current`) never re-run when that node appears — exactly what
// happens here, since the grid/list only mount once `files.length > 0`.
// A callback ref routed through state fixes it: `element` is a real value
// that changes (and re-triggers dependent effects) at the moment the node
// actually mounts.
function useTrackedElement<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);
  return [element, ref] as const;
}

// Downscaled thumbnails fix per-image decode cost, but a batch of several
// hundred still means several hundred decoded <img> buffers alive in the
// DOM at once (each ~300-400KB for a 320px thumbnail) — real memory on a
// constrained device. This renders only rows near the viewport (+ buffer);
// everything else becomes an empty same-size placeholder so scroll height
// and position don't jump as the range shifts. `container` must be a
// distinct element from `scrollContainer` (an ancestor holding the items,
// not the scrollable element itself) — the bounding-rect math needs two
// different reference points to work out the scroll offset.
function useVirtualRange({
  container,
  itemCount,
  columns,
  rowHeightPx,
  scrollContainer = null,
  bufferRows = 3,
}: {
  container: HTMLElement | null;
  itemCount: number;
  columns: number;
  rowHeightPx: number;
  scrollContainer?: HTMLElement | null;
  bufferRows?: number;
}): VirtualRange {
  const [range, setRange] = useState<VirtualRange>({ start: 0, end: itemCount });

  useEffect(() => {
    const totalRows = Math.ceil(itemCount / columns);

    const compute = () => {
      if (rowHeightPx <= 0 || columns <= 0 || !container) {
        setRange({ start: 0, end: itemCount });
        return;
      }
      const containerTop = container.getBoundingClientRect().top;
      let viewTop: number;
      let viewHeight: number;
      let offsetTop: number;
      if (scrollContainer) {
        viewTop = scrollContainer.scrollTop;
        viewHeight = scrollContainer.clientHeight;
        offsetTop = containerTop - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop;
      } else {
        viewTop = window.scrollY;
        viewHeight = window.innerHeight;
        offsetTop = containerTop + window.scrollY;
      }
      const relativeTop = viewTop - offsetTop;
      const firstRow = Math.max(0, Math.floor(relativeTop / rowHeightPx) - bufferRows);
      const lastRow = Math.min(totalRows, Math.ceil((relativeTop + viewHeight) / rowHeightPx) + bufferRows);
      setRange({ start: firstRow * columns, end: Math.min(itemCount, lastRow * columns) });
    };

    compute();
    if (rowHeightPx <= 0 || columns <= 0 || !container) return;

    const scrollTarget = scrollContainer ?? window;
    scrollTarget.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    const resizeObserver = new ResizeObserver(compute);
    resizeObserver.observe(container);

    return () => {
      scrollTarget.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
      resizeObserver.disconnect();
    };
  }, [container, itemCount, columns, rowHeightPx, bufferRows, scrollContainer]);

  return range;
}

// Grid columns switch at Tailwind's `sm` breakpoint (grid-cols-4 sm:grid-cols-6).
function useResponsiveColumns(mobileColumns: number, desktopColumns: number) {
  const [columns, setColumns] = useState(mobileColumns);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setColumns(mq.matches ? desktopColumns : mobileColumns);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [mobileColumns, desktopColumns]);
  return columns;
}

function useElementWidth(element: HTMLElement | null) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const measure = () => setWidth(element ? element.clientWidth : 0);
    measure();
    if (!element) return;
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [element]);
  return width;
}

export default function HomePage() {
  const toast = useToast();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [expiry, setExpiry] = useState("never");
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [step, setStep] = useState<"upload" | "uploading" | "done">("upload");
  const [isIOS, setIsIOS] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFailCount, setUploadFailCount] = useState(0);

  // Must stay in sync with the grid's `gap-2` / `grid-cols-4 sm:grid-cols-6`
  // classes below — this math has no way to read Tailwind's computed gap
  // itself, so a class change here needs a matching constant change.
  const GRID_GAP_PX = 8;
  const [gridEl, gridRef] = useTrackedElement<HTMLDivElement>();
  const gridColumns = useResponsiveColumns(4, 6);
  const gridWidth = useElementWidth(gridEl);
  const gridTileSize = gridWidth > 0 ? (gridWidth - GRID_GAP_PX * (gridColumns - 1)) / gridColumns : 0;
  const gridRange = useVirtualRange({
    container: gridEl,
    itemCount: files.length,
    columns: gridColumns,
    rowHeightPx: gridTileSize > 0 ? gridTileSize + GRID_GAP_PX : 0,
  });

  // Row height varies a little (progress bar only shows while uploading) —
  // approximate and generously buffered, since this only gates which rows
  // mount a real <img> vs. a placeholder, not layout.
  const UPLOADING_ROW_HEIGHT_PX = 76;
  const [uploadingScrollEl, uploadingScrollRef] = useTrackedElement<HTMLDivElement>();
  const [uploadingListEl, uploadingListRef] = useTrackedElement<HTMLDivElement>();
  const uploadingRange = useVirtualRange({
    container: uploadingListEl,
    itemCount: files.length,
    columns: 1,
    rowHeightPx: UPLOADING_ROW_HEIGHT_PX,
    scrollContainer: uploadingScrollEl,
    bufferRows: 4,
  });

  useEffect(() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as Record<string,unknown>).MSStream;
    setIsIOS(ios);
  }, []);
  const [copied, setCopied] = useState(false);

  // Keep a live ref so the unmount cleanup below can revoke whatever
  // previews exist at that point, without re-registering the effect on
  // every files change.
  const filesRef = useRef<FileItem[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => URL.revokeObjectURL(f.preview));
    };
  }, []);

  // Warn before an accidental tab close/refresh wipes an in-flight 50-100
  // photo batch. Uploads now start on drop (before "Tạo album" is even
  // clicked), so this has to watch actual per-file status rather than the
  // `uploading` flag, which only turns on after that click.
  const anyFileInFlight = files.some((f) => f.status === "pending" || f.status === "uploading");
  useEffect(() => {
    if (!anyFileInFlight) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyFileInFlight]);

  // Keep the screen on while uploading — mobile OSes dim/lock the screen
  // after a short idle, and a locked screen is a common way the browser
  // ends up suspending the tab mid-batch. Not a fix for switching away to
  // another app, just for the far more common "phone sits there waiting"
  // case. Feature-detected — unsupported browsers just skip this quietly.
  useEffect(() => {
    if (!anyFileInFlight || !("wakeLock" in navigator)) return;

    let cancelled = false;
    let lock: WakeLockSentinel | null = null;

    const requestLock = async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        lock = sentinel;
      } catch {
        // Denied or not allowed in this context (e.g. backgrounded) — fine, best-effort only.
      }
    };
    requestLock();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !lock) requestLock();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      lock?.release().catch(() => {});
    };
  }, [anyFileInFlight]);

  // Files start uploading the instant they're dropped — while the user is
  // still filling in the album title/password — instead of waiting for the
  // "Tạo album" click. The manager is created once and fed incrementally;
  // its onSettle is where a file's final status (done/error) gets written
  // back, independent of whether "Tạo album" has been pressed yet.
  const managerRef = useRef<UploadManager | null>(null);
  const getManager = useCallback(() => {
    if (!managerRef.current) {
      managerRef.current = new UploadManager({
        onStart: (id) => {
          setFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, status: "uploading", progress: 0, error: undefined } : f))
          );
        },
        onProgress: (id, percentage) => {
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, progress: percentage } : f)));
        },
        onSettle: (id, result) => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id
                ? result.blob
                  ? { ...f, status: "done", progress: 100, url: result.blob.url }
                  : { ...f, status: "error", error: result.error }
                : f
            )
          );
        },
      });
    }
    return managerRef.current;
  }, []);

  // Thumbnails are decoded one at a time (well, THUMBNAIL_CONCURRENCY at a
  // time) instead of all at once — decoding 50-100 full-res originals in
  // parallel would recreate the exact memory spike thumbnails are meant to
  // avoid, just moved from <img> tags into createImageBitmap calls.
  const THUMBNAIL_CONCURRENCY = 3;
  const generateThumbnails = useCallback((items: FileItem[]) => {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        const preview = await createThumbnail(item.file);
        setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, preview } : f)));
      }
    };
    for (let i = 0; i < THUMBNAIL_CONCURRENCY; i++) worker();
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    const newItems: FileItem[] = accepted.map((file) => ({
      id: nanoid(),
      file,
      preview: "",
      status: "pending",
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...newItems]);
    getManager().enqueue(newItems.map((f): UploadTask => ({ id: f.id, file: f.file })));
    generateThumbnails(newItems);
  }, [getManager, generateThumbnails]);

  const retryFailed = () => {
    const failed = files.filter((f) => f.status === "error");
    if (failed.length === 0) return;
    getManager().retry(failed.map((f): UploadTask => ({ id: f.id, file: f.file })));
    toast(`Đang thử lại ${failed.length} ảnh...`, "info");
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected: (rejections) => {
      toast(`${rejections.length} file bị bỏ qua vì không phải ảnh`, "error");
    },
    // iOS Safari's native Photos picker hands back File objects with an
    // empty `type` for HEIC (a long-standing WebKit quirk) — matching by
    // MIME type alone rejects every photo silently, with no grid, no
    // upload, nothing (dropzone's own "not an image" toast fires, but the
    // real symptom is that valid photos never reach onDrop at all). Listing
    // extensions here makes attr-accept fall back to matching by filename
    // when the MIME type is blank, which is exactly this case.
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

  // Stable reference (useCallback) so the memoized grid items below don't
  // see a "changed" prop on every render just because this function was
  // recreated — that would defeat the memoization entirely.
  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const clearAllFiles = () => {
    setFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.preview));
      return [];
    });
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    if (usePassword && !password.trim()) {
      toast("Đã bật mật khẩu nhưng chưa nhập — điền mật khẩu hoặc tắt tuỳ chọn này", "error");
      return;
    }
    setUploadError(null);
    setUploadFailCount(0);
    setStep("uploading");

    // Uploads for these files already started at drop time — this just
    // waits for whatever's still in flight (or queued) to settle, then
    // reads the manager's own results rather than React state, since state
    // updates from onSettle could otherwise race with this closure.
    const filesSnapshot = files;
    await getManager().waitForIdle();
    const results = getManager().getResults(filesSnapshot.map((f) => f.id));

    const uploadedPhotos: { name: string; size: number; type: string; url: string }[] = [];
    let failCount = 0;

    filesSnapshot.forEach((f) => {
      const result = results.find((r) => r.id === f.id);
      if (result?.blob) {
        uploadedPhotos.push({
          name: f.file.name,
          size: f.file.size,
          type: result.blob.contentType,
          url: result.blob.url,
        });
      } else {
        failCount += 1;
      }
    });

    if (uploadedPhotos.length === 0) {
      setStep("upload");
      const message = `Cả ${failCount} ảnh đều upload thất bại. Kiểm tra mạng rồi bấm tạo album lại để thử lại.`;
      setUploadError(message);
      toast(message, "error");
      return;
    }

    setUploadFailCount(failCount);
    if (failCount > 0) {
      toast(`${uploadedPhotos.length} ảnh xong, ${failCount} ảnh lỗi`, "error");
    } else {
      toast(`${uploadedPhotos.length} ảnh upload thành công`, "success");
    }

    let albumRes: Response;
    try {
      albumRes = await fetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || "Album của chúng mình",
          photos: uploadedPhotos,
          password: usePassword ? password : undefined,
          expiresIn: expiry,
          ownerId: getOwnerId(),
        }),
      });
    } catch {
      setStep("upload");
      toast("Không kết nối được để tạo album, ảnh đã upload xong — thử lại", "error");
      return;
    }

    if (!albumRes.ok) {
      setStep("upload");
      toast("Tạo album thất bại, ảnh đã upload xong — bấm tạo album lại để thử lại", "error");
      return;
    }

    const album = await albumRes.json();
    setAlbumId(album.id);
    setStep("done");
    toast("Album đã sẵn sàng!", "success");
  };

  const shareUrl = typeof window !== "undefined" && albumId
    ? `${window.location.origin}/album/${albumId}`
    : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast("Đã copy link", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Không copy được link, thử bấm giữ để copy thủ công", "error");
    }
  };

  const totalSize = files.reduce((acc, f) => acc + f.file.size, 0);
  const doneCount = files.filter(f => f.status === "done").length;
  const errorCount = files.filter(f => f.status === "error").length;
  const remainingCount = files.length - doneCount - errorCount;

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
          className="flex items-center gap-4 text-sm"
        >
          <a
            href="/albums"
            className="flex items-center gap-1.5 text-white/50 hover:text-white/80 transition-colors"
          >
            <ImageIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Album của tôi</span>
          </a>
          <span className="hidden sm:flex items-center gap-1.5 text-white/30">
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
              {/* Upload failure banner */}
              <AnimatePresence>
                {uploadError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 flex items-start gap-3"
                  >
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-red-300">Upload thất bại</p>
                      <p className="text-xs text-red-400/70 mt-0.5">{uploadError}</p>
                    </div>
                    <button onClick={() => setUploadError(null)} className="shrink-0 text-red-400/50 hover:text-red-300">
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* iOS tip — no app/install needed, just the picker's own Format option */}
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
                        Để giữ ảnh HEIC gốc 100%: khi bảng chọn ảnh hiện ra, bấm <strong>Options</strong> ở trên cùng → đổi{" "}
                        <strong>Format</strong> thành <strong>Current</strong> → rồi mới chọn ảnh.
                      </p>
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
                        {remainingCount > 0 && (
                          <span className="text-purple-300"> · đang upload {doneCount + errorCount}/{files.length}</span>
                        )}
                      </span>
                      <div className="flex items-center gap-3">
                        {errorCount > 0 && (
                          <button
                            onClick={retryFailed}
                            className="text-amber-400/70 hover:text-amber-300 transition-colors text-xs font-medium"
                          >
                            Thử lại {errorCount} ảnh lỗi
                          </button>
                        )}
                        <button
                          onClick={clearAllFiles}
                          className="text-white/30 hover:text-red-400 transition-colors text-xs"
                        >
                          Xóa tất cả
                        </button>
                      </div>
                    </div>

                    {/* Grid */}
                    <div ref={gridRef} className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {files.map((item, i) =>
                        i >= gridRange.start && i < gridRange.end ? (
                          <PhotoGridItem
                            key={item.id}
                            id={item.id}
                            preview={item.preview}
                            fileName={item.file.name}
                            fileSize={item.file.size}
                            status={item.status}
                            index={i}
                            onRemove={removeFile}
                          />
                        ) : (
                          <div key={item.id} className="aspect-square rounded-xl bg-white/5" />
                        )
                      )}

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
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-base text-white placeholder-white/25 focus:outline-none focus:border-purple-400/50 transition-colors"
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
                              className="flex-1 min-w-32 bg-white/5 border border-purple-400/30 rounded-xl px-4 py-2.5 text-base text-white placeholder-white/25 focus:outline-none focus:border-purple-400/60 transition-colors"
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
                  <span className="text-green-400 font-semibold">{doneCount} xong</span>
                  {" · "}
                  <span>{remainingCount} còn lại</span>
                  {errorCount > 0 && (
                    <>
                      {" · "}
                      <span className="text-red-400 font-semibold">{errorCount} lỗi</span>
                    </>
                  )}
                </p>
                {/* Overall progress (counts settled items so it doesn't stall on failures) */}
                <div className="w-full max-w-xs mx-auto h-1 bg-white/10 rounded-full overflow-hidden mt-4">
                  <motion.div
                    animate={{ width: `${files.length ? ((doneCount + errorCount) / files.length) * 100 : 0}%` }}
                    className="h-full progress-shimmer rounded-full"
                  />
                </div>
              </div>

              <div ref={uploadingScrollRef} className="max-h-80 overflow-y-auto pr-1">
                <div ref={uploadingListRef} className="space-y-2">
                  {files.map((item, i) =>
                    i >= uploadingRange.start && i < uploadingRange.end ? (
                      <UploadingRow
                        key={item.id}
                        preview={item.preview}
                        fileName={item.file.name}
                        fileSize={item.file.size}
                        status={item.status}
                        progress={item.progress}
                      />
                    ) : (
                      <div key={item.id} style={{ height: UPLOADING_ROW_HEIGHT_PX - 8 }} />
                    )
                  )}
                </div>
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
                  {doneCount} ảnh · {formatBytes(totalSize)} · chất lượng gốc 100%
                </p>
                {uploadFailCount > 0 && (
                  <p className="text-red-400/80 text-sm mt-1">
                    {uploadFailCount} ảnh lỗi, không có trong album: {" "}
                    {files.filter(f => f.status === "error").map(f => f.file.name).join(", ")}
                  </p>
                )}
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
                  onClick={() => {
                    clearAllFiles();
                    setAlbumId(null);
                    setStep("upload");
                    setTitle("");
                    setUploadFailCount(0);
                    setUsePassword(false);
                    setPassword("");
                    setExpiry("never");
                  }}
                  className="px-8 py-3.5 rounded-xl font-semibold text-white/50 border border-white/10 hover:border-white/20 hover:text-white/70 transition-all"
                >
                  Tạo album mới
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}
