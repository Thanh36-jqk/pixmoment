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
}

export interface UploadProgress {
  fileId: string;
  fileName: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  url?: string;
  error?: string;
}
