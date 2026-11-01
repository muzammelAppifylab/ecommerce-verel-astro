/*
 * One-at-a-time toasts for the storefront (VAREL used sonner; sonner injects a <style> element, which the
 * CSP refuses, so this is the same behaviour in a few lines). Any island calls `notify()`; the <Toaster>
 * island mounted once by the storefront layouts shows it bottom-left for 4 seconds.
 */
import type {ReactNode} from 'react';

export interface ToastItem {
  id: number;
  message: ReactNode;
  action?: string;
  onAction?: () => void;
  tone: 'ink' | 'quiet';
  /** Leading glyph name (Icon), or null for none (errors) */
  icon: 'check' | 'alert' | 'info' | null;
  duration: number;
}

type Listener = (toast: ToastItem | null) => void;

let current: ToastItem | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach(l => l(current));

export const toastStore = {
  get: () => current,
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Show a toast (replaces the one on screen). Returns its id. */
  show(toast: Omit<ToastItem, 'id'>): number {
    clearTimeout(timer);
    current = {...toast, id: ++seq};
    emit();
    const id = current.id;
    if (typeof window !== 'undefined' && toast.duration > 0) timer = setTimeout(() => toastStore.dismiss(id), toast.duration);
    return id;
  },
  /** Hide the toast on screen (or only `id`, when given and still shown). */
  dismiss(id?: number) {
    if (!current || (id !== undefined && current.id !== id)) return;
    clearTimeout(timer);
    current = null;
    emit();
  },
};
