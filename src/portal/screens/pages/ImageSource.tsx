/*
 * One image: a thumbnail, its address (paste an https URL) and an Upload button (platform files through
 * the kit's `uploadImage`, pre-sized in the browser). VAREL `pages/admin/journal/fields.tsx` `ImageSource`.
 * Used by the page block editor and the home hero editor.
 */
import {useId, useRef, useState} from 'react';

import {photoUrl} from '../../../lib/format';
import {Button, Icon, imageFileProblem, IMAGE_TYPES, uploadImage, useToast} from '../../ui';

export function ImageSource({
  value,
  onChange,
  label = 'Image',
  invalid,
  errorId,
  disabled,
  tall,
}: {
  value: string;
  onChange: (src: string) => void;
  label?: string;
  invalid?: boolean;
  /** id of the error message under the field (aria-describedby) */
  errorId?: string;
  disabled?: boolean;
  /** 4:5 thumbnail (hero); default 4:5 as well, narrower */
  tall?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const problem = imageFileProblem(file);
    if (problem) return toast.danger(problem);
    setUploading(true);
    uploadImage(file)
      .then(r => onChange(r.url))
      .catch((e: unknown) => toast.danger(e instanceof Error ? e.message : 'The upload failed.'))
      .finally(() => setUploading(false));
  };

  return (
    <div className="cms-image-source">
      <div
        className={['cms-image-thumb', tall ? 'cms-image-thumb-tall' : ''].filter(Boolean).join(' ')}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          if (!disabled) onFile(e.dataTransfer.files?.[0]);
        }}>
        {value ? <img src={photoUrl(value, 200)} alt="" /> : <Icon name="image-plus" size={20} />}
      </div>
      <div className="cms-image-fields">
        <div className="field">
          <label htmlFor={id} className="visually-hidden">
            {label} URL
          </label>
          <input
            id={id}
            value={value}
            placeholder="https://… or upload"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid && errorId ? errorId : undefined}
            onChange={e => onChange(e.target.value)}
          />
        </div>
        <div className="cms-image-actions">
          <Button variant="secondary" size="sm" icon="upload" pending={uploading} pendingLabel="Uploading…" disabled={disabled} onClick={() => fileRef.current?.click()}>
            Upload
          </Button>
          {value && (
            <Button variant="ghost" size="sm" disabled={disabled || uploading} onClick={() => onChange('')}>
              Remove
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          hidden
          aria-label={`Upload ${label.toLowerCase()}`}
          onChange={e => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
