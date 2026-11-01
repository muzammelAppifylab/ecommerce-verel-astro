import {useEffect, useMemo, useRef} from 'react';

/**
 * An email's HTML in a sandboxed iframe (no scripts) that grows to its content height. Port of VAREL
 * src/pages/admin/emails/EmailFrame.tsx, made CSP-safe: a `srcdoc` document inherits the dashboard's CSP (no
 * `'unsafe-inline'`), so the email's `style=""` attributes and `<style>` block would be blocked. Instead the HTML is
 * parsed inertly, every inline style moves to `data-s` and every `<style>` text is collected; once the frame loads
 * they are applied through the CSSOM (`element.style.cssText`, constructable stylesheets), which the CSP allows.
 * The HTML is our own renderer's output with every value escaped and never enters the dashboard's own DOM.
 */

interface Prepared {
  html: string;
  css: string[];
}

function prepare(html: string): Prepared {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const css: string[] = [];
  doc.querySelectorAll('style').forEach(node => {
    css.push(node.textContent ?? '');
    node.remove();
  });
  doc.querySelectorAll('script, link[rel="stylesheet"], meta[http-equiv]').forEach(node => node.remove());
  doc.querySelectorAll<HTMLElement>('[style]').forEach(node => {
    node.setAttribute('data-s', node.getAttribute('style') ?? '');
    node.removeAttribute('style');
  });
  // Links open in a new tab instead of inside the preview.
  const base = doc.createElement('base');
  base.setAttribute('target', '_blank');
  doc.head.prepend(base);
  return {html: `<!doctype html>\n${doc.documentElement.outerHTML}`, css};
}

function applyStyles(doc: Document, css: string[]) {
  doc.querySelectorAll<HTMLElement>('[data-s]').forEach(node => {
    node.style.cssText = node.dataset.s ?? '';
  });
  if (!css.length) return;
  try {
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    const Sheet = win?.CSSStyleSheet ?? CSSStyleSheet;
    const sheet = new Sheet();
    sheet.replaceSync(css.join('\n'));
    doc.adoptedStyleSheets = [sheet];
  } catch {
    /* an old browser: the inline styles above still carry the layout */
  }
}

export function EmailFrame({html, title, minHeight = 480, className}: {html: string; title: string; minHeight?: number; className?: string}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const prepared = useMemo(() => prepare(html), [html]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let ro: ResizeObserver | undefined;
    el.style.height = `${minHeight}px`;
    const measure = () => {
      const doc = el.contentDocument;
      if (!doc?.documentElement) return;
      el.style.height = `${Math.max(minHeight, doc.documentElement.scrollHeight)}px`;
    };
    const onLoad = () => {
      const doc = el.contentDocument;
      if (!doc) return;
      applyStyles(doc, prepared.css);
      measure();
      if (doc.body && 'ResizeObserver' in window) {
        ro = new ResizeObserver(measure);
        ro.observe(doc.body);
      }
    };
    el.addEventListener('load', onLoad);
    el.srcdoc = prepared.html;
    return () => {
      el.removeEventListener('load', onLoad);
      ro?.disconnect();
    };
  }, [prepared, minHeight]);

  return (
    <iframe
      ref={ref}
      title={title}
      // Same origin only so the styles can be applied and the height measured; scripts stay blocked.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className={['email-frame', className].filter(Boolean).join(' ')}
    />
  );
}
