import { useState, useCallback } from "react";

export interface UploadResult {
  objectPath: string;
  contentType: string;
  name: string;
}

export function useUpload(opts: { onSuccess?: (r: UploadResult) => void; onError?: (e: Error) => void } = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadFile = useCallback(async (file: File): Promise<UploadResult | null> => {
    setIsUploading(true); setProgress(0);
    try {
      const token = localStorage.getItem("screencrew_token");
      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error(`Upload URL request failed: ${res.status}`);
      const { uploadURL, objectPath } = await res.json() as { uploadURL: string; objectPath: string };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`GCS upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
      });

      const finalize = await fetch("/api/storage/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ objectPath }),
      });
      if (!finalize.ok) throw new Error(`Finalize failed: ${finalize.status}`);

      const result: UploadResult = { objectPath, contentType: file.type, name: file.name };
      opts.onSuccess?.(result);
      return result;
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setIsUploading(false); setProgress(0);
    }
  }, [opts]);

  return { uploadFile, isUploading, progress };
}
