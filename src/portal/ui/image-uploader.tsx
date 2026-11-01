import {type DragEvent, useRef, useState} from 'react';

import {putFile, type UploadGrant} from '../../platform/files-browser';
import {siteFetch} from '../../platform/browser';
import {Button, IconButton} from './button';
import {ProgressBar} from './display';
import {Icon} from './icon';

/**
 * Product and journal images, ported from VAREL's media section
 * (`pages/admin/products/MediaSection.tsx`): upload (button or drop), paste a
 * URL, drag or move to reorder, remove. The first image is the primary one.
 *
 * Uploads go to the platform's file storage (docs/agent/files.md) as PUBLIC
 * files, pre-sized in the browser (longest edge 2400 px, WebP) so the
 * storefront never serves a camera original:
 *
 *   1. `POST /site-api/manage/uploads` `{name, contentType, size}` → `{fileId, upload}`
 *   2. `putFile(upload, blob)` (the bytes go straight to storage)
 *   3. `POST /site-api/manage/uploads/:fileId/complete` → `{url}` (the public link)
 *
 * The route (`src/server/routes/admin/uploads.ts`) keeps the file id in its
 * own table and checks `site:product:manage` / `site:content:manage`.
 * Previews are `data:` thumbnails (the CSP allows `data:` images, not `blob:`).
 */

export interface ImageItem {
  /** A key for the list (stable while the item moves). */
  uid: string;
  /** The image's address: a public file link or an https URL. Empty while uploading. */
  src: string;
  credit: string | null;
  creditHref: string | null;
  /** The platform file id, when uploaded here. */
  fileId?: string;
  /** 0–1 while uploading. */
  progress?: number;
  /** A small `data:` thumbnail while (and after) uploading. */
  preview?: string;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 2400;
const THUMB_EDGE = 400;

let seq = 0;
/** A key for a new list item. */
export const imageUid = () => `img-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Why a picked file cannot be used, or null. Same rules as the server. */
export function imageFileProblem(file: {name: string; type: string; size: number}): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name}: use JPEG, PNG, WebP or AVIF.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name} is larger than 8 MB.`;
  if (file.size < 1) return `${file.name} is empty.`;
  return null;
}

/** Scale (w, h) down so the longest edge is at most `max`. */
export function fitWithin(width: number, height: number, max: number): {width: number; height: number} {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale))};
}

async function draw(bitmap: ImageBitmap, max: number) {
  const size = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));

/** The upload-ready image (resized WebP, or the original when it is already small and WebP) and a thumbnail. */
export async function prepareImage(file: File): Promise<{blob: Blob; name: string; preview: string}> {
  const bitmap = await createImageBitmap(file);
  try {
    const thumb = await draw(bitmap, THUMB_EDGE);
    const preview = thumb.toDataURL('image/webp', 0.8);
    if (file.type === 'image/webp' && Math.max(bitmap.width, bitmap.height) <= MAX_EDGE) return {blob: file, name: file.name, preview};
    const full = await draw(bitmap, MAX_EDGE);
    const webp = await toBlob(full, 'image/webp', 0.86);
    // Safari before 17 cannot encode WebP: JPEG then.
    const blob = webp && webp.type === 'image/webp' ? webp : await toBlob(full, 'image/jpeg', 0.88);
    if (!blob) return {blob: file, name: file.name, preview};
    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    return {blob, name: `${base}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, preview};
  } finally {
    bitmap.close();
  }
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await siteFetch(url, {
    method: 'POST',
    headers: body === undefined ? {} : {'content-type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & {message?: string}) | null;
  if (!res.ok || !data) throw new Error(data?.message ?? `The upload did not work (${res.status}). Try again.`);
  return data;
}

/** Upload one image to platform storage as a public file; resolves to its public link. */
export async function uploadImage(
  file: File,
  onProgress: (progress: number) => void = () => undefined,
  prepared?: {blob: Blob; name: string}
): Promise<{url: string; fileId: string}> {
  const ready = prepared ?? (await prepareImage(file));
  onProgress(0.15);
  const grant = await postJson<{fileId: string; upload: UploadGrant['upload']}>('/site-api/manage/uploads', {
    name: ready.name,
    contentType: ready.blob.type,
    size: ready.blob.size,
  });
  onProgress(0.3);
  const put = await putFile(grant.upload, ready.blob);
  if (!put.ok) throw new Error(put.message);
  onProgress(0.9);
  const done = await postJson<{url: string}>(`/site-api/manage/uploads/${encodeURIComponent(grant.fileId)}/complete`);
  onProgress(1);
  return {url: done.url, fileId: grant.fileId};
}

export function ImageUploader({
  images,
  onChange,
  error,
  disabled,
  upload = uploadImage,
  label = 'Images',
}: {
  images: ImageItem[];
  /** Functional updates: uploads resolve while other edits happen. */
  onChange: (update: (prev: ImageItem[]) => ImageItem[]) => void;
  /** The field's own error (from the form or the server). */
  error?: string;
  disabled?: boolean;
  /** Replace the platform upload (tests, another route). */
  upload?: typeof uploadImage;
  /** What the images are for, for screen readers. */
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const uploading = images.some(i => i.progress !== undefined);

  function addFiles(files: FileList | File[]) {
    const found: string[] = [];
    for (const file of Array.from(files)) {
      const problem = imageFileProblem(file);
      if (problem) {
        found.push(problem);
        continue;
      }
      const id = imageUid();
      onChange(prev => [...prev, {uid: id, src: '', credit: null, creditHref: null, progress: 0}]);
      prepareImage(file)
        .then(ready => {
          onChange(prev => prev.map(i => (i.uid === id ? {...i, preview: ready.preview, progress: 0.1} : i)));
          return upload(file, p => onChange(prev => prev.map(i => (i.uid === id ? {...i, progress: p} : i))), ready);
        })
        .then(res =>
          onChange(prev => prev.map(i => (i.uid === id ? {uid: id, src: res.url, fileId: res.fileId, credit: null, creditHref: null, preview: i.preview} : i)))
        )
        .catch((e: unknown) => {
          setProblems(current => [...current, `${file.name} could not be uploaded: ${e instanceof Error ? e.message : 'try again.'}`]);
          onChange(prev => prev.filter(i => i.uid !== id));
        });
    }
    setProblems(found);
  }

  function addUrl() {
    const v = url.trim();
    if (!v) return;
    if (!/^https:\/\/\S+$/i.test(v) && !v.startsWith('/__platform/files/')) {
      setUrlError('Paste a full image URL starting with https://');
      return;
    }
    onChange(prev => [...prev, {uid: imageUid(), src: v, credit: null, creditHref: null}]);
    setUrl('');
    setUrlError(null);
  }

  const move = (from: number, to: number) =>
    onChange(prev => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item as ImageItem);
      return next;
    });

  const remove = (id: string) => onChange(prev => prev.filter(i => i.uid !== id));

  function onDropZone(event: DragEvent) {
    event.preventDefault();
    setDropActive(false);
    if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
  }

  const urlId = `${label.replace(/\W+/g, '-').toLowerCase()}-url`;
  return (
    <div className="image-uploader" aria-label={label} role="group">
      <div className="image-uploader-head">
        <p className="image-uploader-hint">The first image is the primary image on the storefront. Drag to reorder.</p>
        <Button variant="secondary" size="sm" icon="upload" disabled={disabled} pending={uploading} pendingLabel="Uploading…" onClick={() => fileRef.current?.click()}>
          Upload
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        hidden
        aria-label="Upload images"
        onChange={event => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div
        className="image-uploader-drop"
        data-active={dropActive ? '' : undefined}
        onDragOver={event => {
          if (dragIndex === null && event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={dragIndex === null ? onDropZone : undefined}>
        {images.length === 0 ? (
          <button type="button" className="image-uploader-empty" disabled={disabled} onClick={() => fileRef.current?.click()}>
            <Icon name="image-plus" size={20} />
            Drop images here or choose files
            <span>JPEG, PNG, WebP or AVIF · up to 8 MB</span>
          </button>
        ) : (
          <ol className="image-grid">
            {images.map((img, i) => (
              <li
                key={img.uid}
                className="image-tile"
                data-dragging={dragIndex === i ? '' : undefined}
                data-over={overIndex === i && dragIndex !== i ? '' : undefined}
                draggable={!disabled && img.progress === undefined}
                onDragStart={event => {
                  setDragIndex(i);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(i));
                }}
                onDragOver={event => {
                  if (dragIndex === null) return;
                  event.preventDefault();
                  setOverIndex(i);
                }}
                onDrop={event => {
                  if (dragIndex === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  move(dragIndex, i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}>
                <div className="image-tile-frame" data-uploading={img.progress !== undefined ? '' : undefined}>
                  {(img.preview ?? img.src) && <img src={img.preview ?? img.src} alt={i === 0 ? 'Primary image' : `Image ${i + 1}`} loading="lazy" decoding="async" />}
                  {i === 0 && <span className="image-tile-primary">Primary</span>}
                  {img.progress !== undefined && (
                    <div className="image-tile-progress">
                      <ProgressBar value={Math.round(img.progress * 100)} label="Upload progress" />
                      <p>Uploading {Math.round(img.progress * 100)}%</p>
                    </div>
                  )}
                </div>
                <div className="image-tile-actions">
                  <Icon name="grip" size={14} className="image-tile-grip" />
                  <span>
                    <IconButton icon="chevron-left" label="Move earlier" size="sm" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} />
                    <IconButton icon="chevron-right" label="Move later" size="sm" disabled={disabled || i === images.length - 1} onClick={() => move(i, i + 1)} />
                    <IconButton icon="trash" label="Remove image" size="sm" disabled={disabled || img.progress !== undefined} onClick={() => remove(img.uid)} />
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="image-uploader-url">
        <label htmlFor={urlId} className="visually-hidden">
          Image URL
        </label>
        <input
          id={urlId}
          type="url"
          value={url}
          disabled={disabled}
          placeholder="Or paste an image URL"
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? `${urlId}-error` : undefined}
          onChange={event => {
            setUrl(event.target.value);
            setUrlError(null);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addUrl();
            }
          }}
        />
        <Button variant="secondary" size="sm" onClick={addUrl} disabled={disabled || !url.trim()}>
          Add
        </Button>
      </div>
      {(urlError || error || problems.length > 0) && (
        <div className="field-error" id={`${urlId}-error`} role="alert">
          {[urlError, error, ...problems].filter(Boolean).map((message, i) => (
            <p key={i}>{message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
