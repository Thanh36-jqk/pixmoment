import { upload } from "@vercel/blob/client";
import type { PutBlobResult } from "@vercel/blob";

// Cap concurrent uploads so 50-100 photos don't all fight over bandwidth
// (and the browser's own per-host connection limit) at once — a handful of
// parallel uploads finishes far faster than one-at-a-time while staying
// well clear of connection throttling and mobile-network flakiness.
const CONCURRENCY = 4;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
// Matches the SDK's own part size — multipart only pays off once a file is
// actually big enough to be split; below this it just adds two wasted
// round trips (create + complete) on top of a plain single-request PUT.
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

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

export async function uploadFilesWithConcurrency(
  tasks: UploadTask[],
  callbacks: UploadCallbacks = {}
): Promise<UploadResult[]> {
  const results: UploadResult[] = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await uploadOne(tasks[index], callbacks);
    }
  }

  const workerCount = Math.min(CONCURRENCY, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}
