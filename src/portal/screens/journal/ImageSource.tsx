import {useId, useRef, useState} from 'react';

import {photoUrl} from '../../../lib/format';
import {Button, Icon, IMAGE_TYPES, imageFileProblem, uploadImage} from '../../ui';

/**
 * One image (a cover, an image block): thumbnail, URL field and Upload / Remove. Port of VAREL
 * `pages/admin/journal/fields.tsx` `ImageSource`; uploads go through the kit's `uploadImage`
 * (platform files, pre-sized to WebP: `POST /site-api/manage/uploads`, WP-17). The kit's
 * `ImageUploader` is a multi-image list; a post has exactly one cover, so this stays single.
 */
export function ImageSource({
  value,
  onChange,
  label = 'Image',
  invalid,
  describedBy,
  id,
  wide,
}: {
  value: string;
  onChange: (src: string) => void;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  /** The URL input's id (a `Field`'s label points at it). */
  id?: string;
  /** 16/9 thumbnail (the cover) instead of 4/5 (a body image). */
  wide?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const ownId = useId();
  const inputId = id ?? ownId;
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const p = imageFileProblem(file);
    if (p) return setProblem(p);
    setProblem(null);
    setPending(true);
    uploadImage(file)
      .then(r => onChange(r.url))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'The upload failed.'))
      .finally(() => setPending(false));
  };

  return (
    <div className="journal-image-source">
      <div
        className="journal-image-thumb"
        data-wide={wide ? '' : undefined}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          onFile(e.dataTransfer.files?.[0]);
        }}>
        {value ? <img src={photoUrl(value, 200)} alt="" /> : <Icon name="image-plus" size={20} />}
        {pending && <span className="journal-image-busy" aria-hidden="true"><span className="spinner" /></span>}
      </div>
      <div className="journal-image-fields">
        {!id && (
          <label htmlFor={inputId} className="visually-hidden">
            {label} URL
          </label>
        )}
        <div className="field">
          <input
            id={inputId}
            value={value}
            placeholder="https://… or upload"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={e => onChange(e.target.value)}
          />
        </div>
        <div className="journal-image-actions">
          <Button variant="secondary" size="sm" icon="upload" pending={pending} pendingLabel="Uploading…" onClick={() => fileRef.current?.click()}>
            Upload
          </Button>
          {value && (
            <Button variant="ghost" size="sm" icon="x" disabled={pending} onClick={() => onChange('')}>
              Remove
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            hidden
            tabIndex={-1}
            aria-label={`Upload ${label.toLowerCase()}`}
            onChange={e => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {problem && (
          <p className="field-error" role="alert">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
