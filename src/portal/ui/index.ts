/**
 * The portal's UI kit: import EVERYTHING from here (`import {Button, Card} from '../ui'`).
 * Every screen is built from these pieces, so the whole app looks and behaves
 * as one (docs/agent/ui.md). Need something that is not here? Build it in
 * this folder from the same tokens (`src/styles/global.css`) and classes
 * (`src/styles/app.css`), export it here, and use it everywhere; never a
 * second UI library.
 *
 * On screen while you work: `/dashboard/components` in the Preview (dev only).
 */
export * from './button';
export * from './display';
export * from './form';
export * from './icon';
export * from './nav';
export * from './overlay';
export * from './table';
// VAREL kit additions (docs/migration/PLAN.md §6), on screen at /dashboard/components.
export * from './chart';
export * from './date-range';
export * from './image-uploader';
export * from './inputs';
export * from './placeholder';
export * from './popover';
export * from './rich-text-editor';
export * from './sortable';
export * from './translation-editor';
