import type { FileRecord } from './types';
import { isIgnoredPath } from './sources';

// --- Dropzone tuning ---------------------------------------------------------
export const DROPZONE_CONFIG = {
  /** entry.file() calls resolved per batch before yielding to the event loop. */
  fileBatchSize: 200,
  /** Progress callback cadence: report every N parcels surveyed. */
  progressEvery: 50,
} as const;

/** One dropped top-level item, destined to become a district (or Harborside). */
export interface DroppedFolder {
  name: string;
  files: FileRecord[];
  totalSize: number;
  /** True for the synthetic group of loose files dropped outside any folder. */
  isLooseGroup: boolean;
}

export interface DropzoneCallbacks {
  /** Live "surveying: N parcels" counter during a read. */
  onProgress: (count: number) => void;
  /** All folders from one drop gesture, fully read. */
  onFolders: (folders: DroppedFolder[]) => void;
  onError: (message: string) => void;
  /** Toggle for the "Drop a folder to found a city!" overlay. */
  onDragState: (active: boolean) => void;
}

const yieldToEventLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Reads every entry in a directory. readEntries returns AT MOST ~100 entries
 * per call by spec quirk, so it MUST be called in a loop until it returns
 * an empty batch — a single call silently drops the rest of large folders.
 */
async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/** Recursively collects file entries under a root, skipping ignored dirs. */
async function collectFileEntries(
  root: FileSystemEntry,
  out: FileSystemFileEntry[],
): Promise<void> {
  if (root.isFile) {
    out.push(root as FileSystemFileEntry);
    return;
  }
  if (!root.isDirectory) return;
  const entries = await readAllEntries(root as FileSystemDirectoryEntry);
  for (const entry of entries) {
    if (entry.isDirectory && isIgnoredPath(`${entry.name}/x`)) continue;
    await collectFileEntries(entry, out);
  }
}

/** Strips the leading root-folder segment so paths are relative to the drop. */
function relativePath(fullPath: string, rootName: string): string {
  const noLead = fullPath.replace(/^\//, '');
  const prefix = `${rootName}/`;
  return noLead.startsWith(prefix) ? noLead.slice(prefix.length) : noLead;
}

/**
 * Resolves entry.file() for every collected entry in batches, yielding to the
 * event loop between batches so the "surveying" counter can paint. Reads
 * name/path/size ONLY — file contents are never touched and never leave the
 * browser.
 */
async function entriesToRecords(
  entries: FileSystemFileEntry[],
  rootName: string,
  onProgress: (n: number) => void,
  progressBase: number,
): Promise<FileRecord[]> {
  const records: FileRecord[] = [];
  for (let i = 0; i < entries.length; i += DROPZONE_CONFIG.fileBatchSize) {
    const batch = entries.slice(i, i + DROPZONE_CONFIG.fileBatchSize);
    const files = await Promise.all(
      batch.map(
        (entry) =>
          new Promise<{ path: string; size: number } | null>((resolve) => {
            entry.file(
              (f) => resolve({ path: relativePath(entry.fullPath, rootName), size: f.size }),
              () => resolve(null), // unreadable entries are skipped, not fatal
            );
          }),
      ),
    );
    for (const f of files) {
      if (f && !isIgnoredPath(f.path)) records.push(f);
    }
    onProgress(progressBase + records.length);
    await yieldToEventLoop();
  }
  return records;
}

/** Reads one dropped DataTransferItem entry into a DroppedFolder. */
async function readDroppedEntry(
  entry: FileSystemEntry,
  onProgress: (n: number) => void,
  progressBase: number,
): Promise<DroppedFolder | null> {
  if (entry.isDirectory) {
    const fileEntries: FileSystemFileEntry[] = [];
    await collectFileEntries(entry, fileEntries);
    const files = await entriesToRecords(fileEntries, entry.name, onProgress, progressBase);
    return {
      name: entry.name,
      files,
      totalSize: files.reduce((s, f) => s + f.size, 0),
      isLooseGroup: false,
    };
  }
  if (entry.isFile) {
    const files = await entriesToRecords(
      [entry as FileSystemFileEntry],
      '', // loose file: keep its own name as the path
      onProgress,
      progressBase,
    );
    const first = files[0];
    if (!first) return null;
    return { name: entry.name, files, totalSize: first.size, isLooseGroup: true };
  }
  return null;
}

/** Converts a plain FileList (fallback inputs) into DroppedFolders. */
export function fileListToFolders(list: FileList): DroppedFolder[] {
  const byRoot = new Map<string, FileRecord[]>();
  const loose: FileRecord[] = [];
  for (let i = 0; i < list.length; i++) {
    const f = list.item(i);
    if (!f) continue;
    // webkitdirectory gives webkitRelativePath ("root/sub/file.ts").
    const rel = f.webkitRelativePath !== '' ? f.webkitRelativePath : f.name;
    if (isIgnoredPath(rel)) continue;
    const slash = rel.indexOf('/');
    if (slash === -1) {
      loose.push({ path: rel, size: f.size });
    } else {
      const root = rel.slice(0, slash);
      const rest = rel.slice(slash + 1);
      let arr = byRoot.get(root);
      if (!arr) {
        arr = [];
        byRoot.set(root, arr);
      }
      arr.push({ path: rest, size: f.size });
    }
  }
  const folders: DroppedFolder[] = [];
  for (const [name, files] of byRoot) {
    folders.push({
      name,
      files,
      totalSize: files.reduce((s, f) => s + f.size, 0),
      isLooseGroup: false,
    });
  }
  for (const f of loose) {
    folders.push({ name: f.path, files: [f], totalSize: f.size, isLooseGroup: true });
  }
  return folders;
}

/** Wires drag-and-drop onto the whole viewport. Returns an unlisten function. */
export function attachDropzone(cb: DropzoneCallbacks): () => void {
  let dragDepth = 0;

  const onDragEnter = (e: DragEvent): void => {
    e.preventDefault();
    dragDepth++;
    cb.onDragState(true);
  };
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
  };
  const onDragLeave = (e: DragEvent): void => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) cb.onDragState(false);
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    dragDepth = 0;
    cb.onDragState(false);
    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i]?.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length === 0) {
      cb.onError('That drop had no readable folders or files.');
      return;
    }
    void (async () => {
      try {
        const folders: DroppedFolder[] = [];
        let surveyed = 0;
        for (const entry of entries) {
          const folder = await readDroppedEntry(entry, cb.onProgress, surveyed);
          if (folder) {
            folders.push(folder);
            surveyed += folder.files.length;
          }
        }
        cb.onFolders(folders);
      } catch {
        cb.onError('Something went wrong reading that folder. Try the file picker?');
      }
    })();
  };

  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('drop', onDrop);
  };
}
