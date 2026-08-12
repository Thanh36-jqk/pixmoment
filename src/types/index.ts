export interface PhotoFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  uploadedAt: string;
}

export interface Album {
  id: string;
  title: string;
  description?: string;
  photos: PhotoFile[];
  createdAt: string;
  password?: string;
  expiresAt?: string;
  totalSize: number;
  // Per-browser id (see src/lib/ownerToken.ts), not a real account — lets
  // the creator list albums they made on this device. Never returned to
  // clients (stripped alongside password in the album API routes).
  ownerId?: string | null;
}

// One entry in a creator's "my albums" history (src/app/api/albums/mine).
export interface AlbumSummary {
  id: string;
  title: string;
  createdAt: string;
  photoCount: number;
  totalSize: number;
  coverUrl?: string;
}

export interface UploadProgress {
  fileId: string;
  fileName: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  url?: string;
  error?: string;
}
