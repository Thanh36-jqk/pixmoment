import { upload } from "@vercel/blob/client";
import type { PutBlobResult } from "@vercel/blob";

// Cap concurrent uploads so 50-100 photos don't all fight over bandwidth
// (and the browser's own per-host connection limit) at once — a handful of
// parallel uploads finishes far faster than one-at-a-time while staying
// well clear of connection throttling and mobile-network flakiness.
const CONCURRENCY = 4;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
// Vercel's own guidance: "For files over 100 MB, use multipart" — below
// that, a plain single-request PUT is simpler and just as reliable, and
// skips the two extra round trips (create + complete) multipart adds.
const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;

export interface UploadTask {
  id: string;
  file: File;
}

export interface UploadResult {
  id: string;
  blob?: PutBlobResult;
  error?: string;
}

export interface UploadCallbacks {
  onStart?: (id: string) => void;
  onProgress?: (id: string, percentage: number) => void;
  onSettle?: (id: string, result: UploadResult) => void;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadOne(task: UploadTask, callbacks: UploadCallbacks): Promise<UploadResult> {
  const ext = task.file.name.split(".").pop() ?? "jpg";
  const pathname = `photos/${task.id}.${ext}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    callbacks.onStart?.(task.id);
    try {
      const blob = await upload(pathname, task.file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: task.file.type || "application/octet-stream",
        multipart: task.file.size > MULTIPART_THRESHOLD_BYTES,
        onUploadProgress: ({ percentage }) => callbacks.onProgress?.(task.id, percentage),
      });
      return { id: task.id, blob };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  return {
    id: task.id,
    error: lastError instanceof Error ? lastError.message : "Upload failed",
  };
}

// A persistent worker pool that files can be fed into at any time (as soon
// as they're dropped, rather than only when a "start upload" button is
// pressed), while still capping concurrency across everything in flight.
// waitForIdle() lets a caller (e.g. "create album") know when everything
// currently queued has settled; retry() re-runs just the failed ones
// instead of the whole batch.
export class UploadManager {
  private queue: UploadTask[] = [];
  private active = 0;
  private results = new Map<string, UploadResult>();
  private idleWaiters: (() => void)[] = [];
  private callbacks: UploadCallbacks;

  constructor(callbacks: UploadCallbacks = {}) {
    this.callbacks = callbacks;
  }

  enqueue(tasks: UploadTask[]) {
    this.queue.push(...tasks);
    this.pump();
  }

  retry(tasks: UploadTask[]) {
    tasks.forEach((t) => this.results.delete(t.id));
    this.enqueue(tasks);
  }

  private pump() {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.active++;
      uploadOne(task, this.callbacks).then((result) => {
        this.results.set(task.id, result);
        this.active--;
        this.callbacks.onSettle?.(task.id, result);
        this.pump();
        if (this.active === 0 && this.queue.length === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          waiters.forEach((resolve) => resolve());
        }
      });
    }
  }

  waitForIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  getResults(ids: string[]): UploadResult[] {
    return ids.map((id) => this.results.get(id)).filter((r): r is UploadResult => !!r);
  }
}
