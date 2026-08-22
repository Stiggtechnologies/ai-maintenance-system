export const SYNC_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
  "log",
  "xlsx",
]);

export function sanitizeSyncAttachmentName(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return cleaned || "attachment";
}

export function syncAttachmentExtension(name: string): string {
  const safe = sanitizeSyncAttachmentName(name);
  const dot = safe.lastIndexOf(".");
  return dot >= 0 ? safe.slice(dot + 1).toLowerCase() : "";
}

export function validateSyncAttachment(file: Pick<File, "name" | "size">): string | null {
  if (file.size <= 0) return "The file is empty.";
  if (file.size > SYNC_ATTACHMENT_MAX_BYTES) return "Attachments must be 25 MB or smaller.";
  if (!ACCEPTED_EXTENSIONS.has(syncAttachmentExtension(file.name))) {
    return "Supported files: PDF, images, text/Markdown, CSV/JSON/XML/YAML/logs, and XLSX.";
  }
  return null;
}

export function buildSyncAttachmentObjectPath(input: {
  organizationId: string;
  userId: string;
  workspaceId: string;
  fileName: string;
  objectId?: string;
}): string {
  const objectId = input.objectId ?? crypto.randomUUID();
  return [
    input.organizationId,
    input.userId,
    input.workspaceId,
    `${objectId}-${sanitizeSyncAttachmentName(input.fileName)}`,
  ].join("/");
}

export async function sha256File(file: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}
