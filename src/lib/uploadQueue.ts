import { upload } from "@vercel/blob/client";
import type { PutBlobResult } from "@vercel/blob";

// Cap concurrent uploads so 50-100 photos don't all fight over bandwidth
// (and the browser's own per-host connection limit) at once — a handful of
// parallel uploads finishes far faster than one-at-a-time while staying
// well clear of connection throttling and mobile-network flakiness.
const DEFAULT_CONCURRENCY = 4;
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

// Non-standard API — not in TS's DOM lib, and Safari (desktop + iOS) has
// zero support for it, so this only ever kicks in on Chromium/Android.
// Everywhere else silently keeps DEFAULT_CONCURRENCY, unchanged.
interface NetworkInformationLike {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
}

function getAdaptiveConcurrency(): number {
  if (typeof navigator === "undefined") return DEFAULT_CONCURRENCY;

  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!connection) return DEFAULT_CONCURRENCY;

  // Respect the user's explicit data-saver preference over anything else.
  if (connection.saveData) return 1;

  switch (connection.effectiveType) {
    case "slow-2g":
    case "2g":
      return 1;
    case "3g":
      return 2;
    default:
      return DEFAULT_CONCURRENCY;
  }
}

interface InternalCallbacks extends UploadCallbacks {
  // Fired with a bytes/sec sample computed directly from onUploadProgress
  // deltas — works identically in every browser (Safari included) since
  // it needs no special API, just our own timing math on real transfers.
  onThroughputSample?: (bytesPerSecond: number) => void;
}

async function uploadOne(task: UploadTask, callbacks: InternalCallbacks): Promise<UploadResult> {
  const ext = task.file.name.split(".").pop() ?? "jpg";
  const pathname = `photos/${task.id}.${ext}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    callbacks.onStart?.(task.id);
    let lastSampleTime = 0;
    let lastSampleLoaded = 0;
    try {
      const blob = await upload(pathname, task.file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: task.file.type || "application/octet-stream",
        multipart: task.file.size > MULTIPART_THRESHOLD_BYTES,
        onUploadProgress: ({ loaded, percentage }) => {
          callbacks.onProgress?.(task.id, percentage);

          const now = Date.now();
          const deltaSeconds = (now - lastSampleTime) / 1000;
          const deltaBytes = loaded - lastSampleLoaded;
          // Skip near-zero intervals — the division gets noisy/unreliable
          // when barely any time or data has passed between samples.
          if (lastSampleTime > 0 && deltaSeconds > 0.2 && deltaBytes > 0) {
            callbacks.onThroughputSample?.(deltaBytes / deltaSeconds);
          }
          lastSampleTime = now;
          lastSampleLoaded = loaded;
        },
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
// Slow/fast thresholds in bytes/sec — rough, deliberately conservative
// equivalents of "2g-ish" and "3g-ish" real-world throughput, since these
// aren't from a spec (there's nothing to cite for a self-measured signal),
// just reasonable cutoffs for "clearly struggling" vs "clearly fine".
const SLOW_THROUGHPUT_BPS = 300 * 1024;
const OK_THROUGHPUT_BPS = 1024 * 1024;
const MIN_SAMPLES_BEFORE_TRUSTING = 3;
const MAX_THROUGHPUT_SAMPLES = 8;

export class UploadManager {
  private queue: UploadTask[] = [];
  private active = 0;
  private results = new Map<string, UploadResult>();
  private idleWaiters: (() => void)[] = [];
  private callbacks: UploadCallbacks;
  // Real observed bytes/sec from this session's own transfers — works in
  // every browser (including Safari, which has no Network Information API
  // at all) since it's measured directly from onUploadProgress, not asked
  // of the OS.
  private throughputSamples: number[] = [];

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

  // Smallest-first instead of drop-order: doesn't change total transfer
  // time, but a batch mixing regular photos with a couple of huge RAW
  // files finishes visible photos much sooner this way instead of having
  // early slots pinned on a 50MB file for a while.
  private takeSmallestQueued(): UploadTask | undefined {
    if (this.queue.length === 0) return undefined;
    let smallestIndex = 0;
    for (let i = 1; i < this.queue.length; i++) {
      if (this.queue[i].file.size < this.queue[smallestIndex].file.size) {
        smallestIndex = i;
      }
    }
    return this.queue.splice(smallestIndex, 1)[0];
  }

  private recordThroughput(bytesPerSecond: number) {
    this.throughputSamples.push(bytesPerSecond);
    if (this.throughputSamples.length > MAX_THROUGHPUT_SAMPLES) {
      this.throughputSamples.shift();
    }
  }

  // Harmonic mean (not arithmetic) — the standard choice for averaging
  // rates, since it weighs slow samples appropriately instead of letting
  // one fast burst hide a mostly-slow connection.
  private getObservedConcurrency(): number | null {
    if (this.throughputSamples.length < MIN_SAMPLES_BEFORE_TRUSTING) return null;
    const n = this.throughputSamples.length;
    const sumOfReciprocals = this.throughputSamples.reduce((acc, rate) => acc + 1 / rate, 0);
    const harmonicMean = n / sumOfReciprocals;

    if (harmonicMean < SLOW_THROUGHPUT_BPS) return 1;
    if (harmonicMean < OK_THROUGHPUT_BPS) return 2;
    return null; // healthy connection — defer to Network Info API / default
  }

  private pump() {
    // Real measurements (once we have enough) take priority over the
    // Network Information API guess, since they're direct and — unlike
    // that API — available on Safari. Re-read every pump so a mid-batch
    // network change is picked up for the next slot that opens up.
    const concurrency = this.getObservedConcurrency() ?? getAdaptiveConcurrency();
    while (this.active < concurrency && this.queue.length > 0) {
      const task = this.takeSmallestQueued();
      if (!task) break;
      this.active++;
      uploadOne(task, {
        ...this.callbacks,
        onThroughputSample: (rate) => this.recordThroughput(rate),
      }).then((result) => {
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
