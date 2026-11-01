/*
 * Home hero copy, buttons and image — `PATCH /site-api/manage/settings {homeHero}` (WP-23's route).
 * Port of VAREL `src/pages/admin/navigation/HeroEditor.tsx` on the portal kit.
 */
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useId, useState} from 'react';

import type {HomeHero} from '../../../lib/types/settings';
import {ApiError} from '../../api';
import {navigationKeys, saveHomeHero, storeSettingsQuery} from '../../queries/navigation';
import {Button, Card, Field, LoadingBlock, Notice, useToast} from '../../ui';
import {ImageSource} from '../pages/ImageSource';
import {DEFAULT_HERO, type HeroForm, heroFormOf, resolveHero, toHero, validateHero} from './hero';
import {HeroPreview} from './HeroPreview';

export function HeroEditor({readOnly}: {readOnly?: boolean}) {
  const {data, isPending, error, refetch, isRefetching} = useQuery(storeSettingsQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const stored = data?.homeHero;
  const [f, setF] = useState<HeroForm>(() => heroFormOf(stored));
  const [base, setBase] = useState(() => JSON.stringify(heroFormOf(stored)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'save' | 'reset' | null>(null);
  const uid = useId();
  const ids = {
    eyebrow: `${uid}-eyebrow`,
    title: `${uid}-title`,
    body: `${uid}-body`,
    pl: `${uid}-pl`,
    pu: `${uid}-pu`,
    sl: `${uid}-sl`,
    su: `${uid}-su`,
    image: `${uid}-image`,
  };

  useEffect(() => {
    if (!data) return;
    const next = heroFormOf(stored);
    setF(next);
    setBase(JSON.stringify(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const dirty = JSON.stringify(f) !== base;
  const custom = !!stored && Object.keys(stored).length > 0;
  const set = (p: Partial<HeroForm>) => {
    setF(prev => ({...prev, ...p}));
    setErrors(e => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in p))));
  };
  const disabled = readOnly || saving !== null;

  const submit = async (hero?: HomeHero) => {
    if (!hero) {
      const errs = validateHero(f);
      setErrors(errs);
      if (Object.keys(errs).length) {
        toast.danger('Check the highlighted fields.');
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.cms-hero-form [aria-invalid="true"]')?.focus());
        return;
      }
    }
    setSaving(hero ? 'reset' : 'save');
    try {
      const settings = await saveHomeHero(hero ?? toHero(f));
      if (settings && typeof settings === 'object' && 'homeHero' in settings) queryClient.setQueryData(navigationKeys.settings, settings);
      else void queryClient.invalidateQueries({queryKey: navigationKeys.settings});
      toast.success(hero ? 'Home hero reset to the original' : 'Home hero saved');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        // `homeHero.title` → `title` (the form's own keys)
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^homeHero\./, ''), v])));
      }
      toast.danger(err instanceof Error && err.message ? err.message : 'The home hero could not be saved.');
    } finally {
      setSaving(null);
    }
  };

  if (error && !data)
    return (
      <Card title="Home hero">
        <Notice
          tone="danger"
          title="The home hero did not load."
          action={
            <Button variant="secondary" size="sm" pending={isRefetching} pendingLabel="Trying…" onClick={() => void refetch()}>
              Try again
            </Button>
          }>
          {error.message}
        </Notice>
      </Card>
    );

  const input = (key: keyof HeroForm, id: string, extra: {mono?: boolean; maxLength?: number} = {}) => ({
    id,
    value: f[key],
    disabled,
    maxLength: extra.maxLength,
    spellCheck: extra.mono ? false : undefined,
    className: extra.mono ? 'cms-mono' : undefined,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${id}-error` : undefined,
    onChange: (e: {target: {value: string}}) => set({[key]: e.target.value} as Partial<HeroForm>),
  });

  return (
    <Card
      title="Home hero"
      description="The first thing on the home page. Line breaks in the headline are kept."
      actions={
        !readOnly && (
          <>
            {custom && !dirty && (
              <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={() => void submit({})} pending={saving === 'reset'} pendingLabel="Resetting…" disabled={saving !== null}>
                Use original
              </Button>
            )}
            {dirty && (
              <Button variant="ghost" size="sm" onClick={() => setF(JSON.parse(base) as HeroForm)} disabled={saving !== null}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={() => void submit()} pending={saving === 'save'} pendingLabel="Saving…" disabled={!dirty || isPending || saving !== null}>
              Save
            </Button>
          </>
        )
      }>
      {isPending ? (
        <LoadingBlock rows={4} />
      ) : (
        <div className="cms-hero">
          <form
            className="cms-hero-form"
            noValidate
            onSubmit={e => {
              e.preventDefault();
              if (!readOnly && dirty) void submit();
            }}>
            <div className="cms-hero-grid">
              <Field label="Eyebrow" id={ids.eyebrow} error={errors.eyebrow} hint="Small caps line above the headline">
                <input {...input('eyebrow', ids.eyebrow, {maxLength: 60})} />
              </Field>
              <Field label="Headline" id={ids.title} error={errors.title}>
                <textarea {...input('title', ids.title)} rows={2} className="cms-hero-headline" />
              </Field>
              <div className="cms-span-2">
                <Field label="Text" id={ids.body} error={errors.body}>
                  <textarea {...input('body', ids.body)} rows={3} />
                </Field>
              </div>
              <fieldset className="cms-fieldset">
                <legend>Primary button</legend>
                <div className="grid-2 cms-grid">
                  <Field label="Label" id={ids.pl} error={errors.primaryLabel}>
                    <input {...input('primaryLabel', ids.pl, {maxLength: 60})} />
                  </Field>
                  <Field label="Link" id={ids.pu} error={errors.primaryUrl}>
                    <input {...input('primaryUrl', ids.pu, {mono: true, maxLength: 500})} />
                  </Field>
                </div>
              </fieldset>
              <fieldset className="cms-fieldset">
                <legend>Secondary button</legend>
                <div className="grid-2 cms-grid">
                  <Field label="Label" id={ids.sl} error={errors.secondaryLabel}>
                    <input {...input('secondaryLabel', ids.sl, {maxLength: 60})} />
                  </Field>
                  <Field label="Link" id={ids.su} error={errors.secondaryUrl}>
                    <input {...input('secondaryUrl', ids.su, {mono: true, maxLength: 500})} />
                  </Field>
                </div>
              </fieldset>
              <div className="cms-span-2 field" data-invalid={errors.imageSrc ? '' : undefined}>
                <span className="cms-legend">Image</span>
                <ImageSource
                  value={f.imageSrc}
                  onChange={v => set({imageSrc: v, imageCredit: v === DEFAULT_HERO.image.src ? (DEFAULT_HERO.image.credit ?? '') : ''})}
                  label="Hero image"
                  invalid={!!errors.imageSrc}
                  errorId={`${ids.image}-error`}
                  disabled={disabled}
                  tall
                />
                {errors.imageSrc && (
                  <p className="field-error" id={`${ids.image}-error`} role="alert">
                    {errors.imageSrc}
                  </p>
                )}
              </div>
            </div>
            <button type="submit" className="visually-hidden" tabIndex={-1}>
              Save
            </button>
          </form>

          <div>
            <p className="cms-legend">Preview</p>
            <HeroPreview
              hero={resolveHero({
                eyebrow: f.eyebrow,
                title: f.title,
                body: f.body,
                primaryCta: {label: f.primaryLabel, url: f.primaryUrl},
                secondaryCta: {label: f.secondaryLabel, url: f.secondaryUrl},
                image: f.imageSrc ? {src: f.imageSrc, credit: f.imageCredit, creditHref: ''} : undefined,
              })}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
