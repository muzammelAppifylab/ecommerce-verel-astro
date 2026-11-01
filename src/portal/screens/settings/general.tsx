import {useRef, useState} from 'react';

import type {StoreSettings} from '../../../lib/types/admin/store';
import {Button, Field, imageFileProblem, uploadImage} from '../../ui';
import {ORDER_PREFIX_RE, SETTINGS_LIMITS as L, WEB_LINK_RE} from './limits';
import {type Errors, fieldAria, isEmail, Section, type SettingsCodec, SettingsShell, useSettingsDraft} from './shared';

/** Settings · General (port of VAREL `pages/admin/settings/SettingsPage.tsx`): identity, contact, legal, logo, social, order numbers, announcement. */

const SOCIAL = [
  {key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/varel.studio'},
  {key: 'pinterest', label: 'Pinterest', placeholder: 'https://pinterest.com/varelstudio'},
  {key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@varel.studio'},
  {key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/varelstudio'},
  {key: 'x', label: 'X', placeholder: 'https://x.com/varelstudio'},
] as const;
type SocialKey = (typeof SOCIAL)[number]['key'];

interface GeneralForm {
  storeName: string;
  supportEmail: string;
  phone: string;
  legalName: string;
  vatNumber: string;
  businessAddress: string;
  logoUrl: string | null;
  social: Record<SocialKey, string>;
  orderPrefix: string;
  announcement: string;
}

const tooLong = (v: string, max: number) => v.trim().length > max;

export const generalCodec: SettingsCodec<GeneralForm> = {
  toForm: s => ({
    storeName: s.storeName,
    supportEmail: s.supportEmail,
    phone: s.phone,
    legalName: s.legalName,
    vatNumber: s.vatNumber,
    businessAddress: s.businessAddress,
    logoUrl: s.logoUrl,
    social: Object.fromEntries(SOCIAL.map(({key}) => [key, s.socialLinks?.[key] ?? ''])) as Record<SocialKey, string>,
    orderPrefix: s.orderPrefix,
    announcement: s.announcement,
  }),
  toValues: f => {
    const socialLinks: StoreSettings['socialLinks'] = {};
    for (const {key} of SOCIAL) if (f.social[key].trim()) socialLinks[key] = f.social[key].trim();
    return {
      storeName: f.storeName.trim(),
      supportEmail: f.supportEmail.trim(),
      phone: f.phone.trim(),
      legalName: f.legalName.trim(),
      vatNumber: f.vatNumber.trim(),
      businessAddress: f.businessAddress.trim(),
      logoUrl: f.logoUrl,
      socialLinks,
      orderPrefix: f.orderPrefix.trim().toUpperCase(),
      announcement: f.announcement.trim(),
    };
  },
  validate: f => {
    const e: Errors = {};
    if (!f.storeName.trim()) e.storeName = 'Enter a store name';
    else if (tooLong(f.storeName, L.storeName)) e.storeName = `Keep a store name under ${L.storeName} characters`;
    if (!isEmail(f.supportEmail)) e.supportEmail = 'Enter a valid email address';
    const phone = f.phone.trim();
    if (phone && (phone.length > L.phone || !L.phonePattern.test(phone))) e.phone = 'Use digits, spaces and + ( ) - only.';
    if (tooLong(f.legalName, L.legalName)) e.legalName = `Keep this under ${L.legalName} characters`;
    if (tooLong(f.vatNumber, L.vatNumber)) e.vatNumber = `Keep this under ${L.vatNumber} characters`;
    if (tooLong(f.businessAddress, L.businessAddress)) e.businessAddress = `Keep this under ${L.businessAddress} characters`;
    for (const {key, label} of SOCIAL) {
      const v = f.social[key].trim();
      if (v && (!WEB_LINK_RE.test(v) || v.length > L.socialLink)) e[`socialLinks.${key}`] = `Enter the full ${label} link, starting with https://`;
    }
    const prefix = f.orderPrefix.trim().toUpperCase();
    if (!prefix) e.orderPrefix = 'Enter an order prefix, e.g. VRL-';
    else if (prefix.length > L.orderPrefix) e.orderPrefix = 'Keep the prefix under 10 characters';
    else if (!ORDER_PREFIX_RE.test(prefix)) e.orderPrefix = 'Use letters, digits and dashes only';
    else if (!/\D$/.test(prefix)) e.orderPrefix = 'End the prefix with a letter or a dash, e.g. VRL-';
    if (tooLong(f.announcement, L.announcement)) e.announcement = `Keep it under ${L.announcement} characters.`;
    return e;
  },
};

export function GeneralSettings() {
  const draft = useSettingsDraft(generalCodec);
  const {set, touch, errors} = draft;
  return (
    <SettingsShell title="General" description="Store name, contact, legal details, logo, social links and order numbers." draft={draft}>
      {f => (
        <>
          <Section id="store" title="Store" description="How the store names itself and where customers write to.">
            <div className="grid-2">
              <Field label="Store name" id="s-name" error={errors.storeName}>
                <input
                  id="s-name"
                  value={f.storeName}
                  onChange={e => set({storeName: e.target.value})}
                  onBlur={() => touch('storeName')}
                  {...fieldAria('s-name', errors.storeName)}
                />
              </Field>
              <Field label="Support email" id="s-email" error={errors.supportEmail} hint="Shown on emails and the contact page">
                <input
                  id="s-email"
                  type="email"
                  autoComplete="off"
                  value={f.supportEmail}
                  onChange={e => set({supportEmail: e.target.value})}
                  onBlur={() => touch('supportEmail')}
                  {...fieldAria('s-email', errors.supportEmail)}
                />
              </Field>
              <Field label="Phone" id="s-phone" error={errors.phone} hint="Optional. Shown on the contact page">
                <input
                  id="s-phone"
                  type="tel"
                  value={f.phone}
                  placeholder="+45 33 12 34 56"
                  onChange={e => set({phone: e.target.value})}
                  onBlur={() => touch('phone')}
                  {...fieldAria('s-phone', errors.phone)}
                />
              </Field>
            </div>
          </Section>

          <Section id="legal" title="Legal details" description="Printed in the footer, on invoices and on order emails.">
            <div className="grid-2">
              <Field label="Legal name" id="s-legal" error={errors.legalName}>
                <input
                  id="s-legal"
                  value={f.legalName}
                  placeholder="VAREL Studio ApS"
                  onChange={e => set({legalName: e.target.value})}
                  onBlur={() => touch('legalName')}
                  {...fieldAria('s-legal', errors.legalName)}
                />
              </Field>
              <Field label="VAT number" id="s-vat" error={errors.vatNumber}>
                <input
                  id="s-vat"
                  value={f.vatNumber}
                  placeholder="DK12345678"
                  onChange={e => set({vatNumber: e.target.value})}
                  onBlur={() => touch('vatNumber')}
                  {...fieldAria('s-vat', errors.vatNumber)}
                />
              </Field>
            </div>
            <Field label="Business address" id="s-address" error={errors.businessAddress}>
              <textarea
                id="s-address"
                rows={3}
                value={f.businessAddress}
                placeholder={'Store Kongensgade 40\n1264 Copenhagen K\nDenmark'}
                onChange={e => set({businessAddress: e.target.value})}
                onBlur={() => touch('businessAddress')}
                {...fieldAria('s-address', errors.businessAddress)}
              />
            </Field>
          </Section>

          <Section id="logo" title="Logo" description="Used on emails and invoices. The storefront keeps the VAREL wordmark.">
            <LogoField value={f.logoUrl} onChange={logoUrl => set({logoUrl})} disabled={draft.ro} error={errors.logoUrl} />
          </Section>

          <Section id="social" title="Social links" description="Shown in the footer when set. Leave a field empty to hide it.">
            <div className="grid-2">
              {SOCIAL.map(({key, label, placeholder}) => {
                const id = `s-social-${key}`;
                const err = errors[`socialLinks.${key}`] ?? (key === 'instagram' ? errors.socialLinks : undefined);
                return (
                  <Field key={key} label={label} id={id} error={err}>
                    <input
                      id={id}
                      type="url"
                      value={f.social[key]}
                      placeholder={placeholder}
                      onChange={e => set({social: {...f.social, [key]: e.target.value}})}
                      onBlur={() => touch(`socialLinks.${key}`)}
                      {...fieldAria(id, err)}
                    />
                  </Field>
                );
              })}
            </div>
          </Section>

          <Section id="orders" title="Order numbers" description="The prefix before each new order number. Existing orders keep theirs.">
            <div className="settings-narrow">
              <Field label="Prefix" id="s-prefix" error={errors.orderPrefix} hint={`Next orders read ${f.orderPrefix.trim().toUpperCase()}24818`}>
                <input
                  id="s-prefix"
                  className="settings-mono"
                  value={f.orderPrefix}
                  maxLength={L.orderPrefix}
                  spellCheck={false}
                  onChange={e => set({orderPrefix: e.target.value.toUpperCase()})}
                  onBlur={() => touch('orderPrefix')}
                  {...fieldAria('s-prefix', errors.orderPrefix)}
                />
              </Field>
            </div>
          </Section>

          <Section id="announcement" title="Announcement" description="The strip above the storefront header. Leave empty to hide it.">
            <Field label="Text" id="s-announcement" error={errors.announcement} hint={`${f.announcement.trim().length}/${L.announcement}`}>
              <input
                id="s-announcement"
                value={f.announcement}
                maxLength={L.announcement + 40}
                onChange={e => set({announcement: e.target.value})}
                onBlur={() => touch('announcement')}
                {...fieldAria('s-announcement', errors.announcement)}
              />
            </Field>
            <div>
              <p className="settings-label">Preview</p>
              {f.announcement.trim() ? (
                <div className="settings-announcement">{f.announcement.trim()}</div>
              ) : (
                <div className="settings-announcement-empty">The bar is hidden</div>
              )}
            </div>
          </Section>
        </>
      )}
    </SettingsShell>
  );
}

/** The logo box with Upload / Replace / Remove; uploads go to platform storage as a public file. */
export function LogoField({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    const bad = imageFileProblem(file);
    if (bad) return setProblem(bad);
    setProblem(null);
    setUploading(true);
    try {
      const {url} = await uploadImage(file);
      onChange(url);
    } catch (err) {
      setProblem(err instanceof Error && err.message ? err.message : 'The logo could not be uploaded. Try again.');
    } finally {
      setUploading(false);
    }
  }

  const message = problem ?? error;
  return (
    <div className="settings-logo">
      <div className="settings-logo-box">{value ? <img src={value} alt="Store logo" /> : <span className="muted">No logo</span>}</div>
      {!disabled && (
        <div className="settings-logo-actions">
          <div className="form-actions">
            <Button variant="secondary" size="sm" icon="image-plus" pending={uploading} pendingLabel="Uploading…" onClick={() => input.current?.click()}>
              {value ? 'Replace' : 'Upload logo'}
            </Button>
            {value && (
              <Button variant="ghost" size="sm" icon="trash" disabled={uploading} onClick={() => onChange(null)}>
                Remove
              </Button>
            )}
          </div>
          {message ? (
            <p className="field-error" role="alert">
              {message}
            </p>
          ) : (
            <p className="field-hint">PNG, JPG, WebP or AVIF, under 8 MB. A transparent background works best.</p>
          )}
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Logo file"
            onChange={e => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
