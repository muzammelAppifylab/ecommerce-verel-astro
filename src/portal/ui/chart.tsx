import {type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore} from 'react';

/**
 * The dashboard's charts beyond `Sparkline` / `BarChart` (display.tsx):
 * VAREL's sales chart (`pages/admin/dashboard/SalesChart.tsx`) and a line
 * chart for trends over time. SVG drawn with attributes and classes (no
 * `style=""`), theme colours only, a hover / keyboard readout, and the numbers
 * in a table for screen readers and anyone who prefers one.
 */

// ---------------------------------------------------------------- motion --

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

/** True when the visitor asked the OS for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(REDUCED).matches, () => false);
}

const easeOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Tweens a number toward `target`: counts up from 0 on mount, then from the value on screen. */
export function useTween(target: number, duration = 720): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const shown = useRef(value);
  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      shown.current = target;
      return;
    }
    const from = shown.current;
    if (from === target) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const v = from + (target - from) * easeOut((now - start) / duration);
      shown.current = v;
      setValue(v);
      if (now - start < duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return reduced || !Number.isFinite(target) ? target : value;
}

/** Counts to `value` on mount and recounts when it changes. Screen readers get the final value only. */
export function CountUp({value, format = n => String(Math.round(n))}: {value: number; format?: (n: number) => string}) {
  const shown = useTween(value);
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="visually-hidden">{format(value)}</span>
    </>
  );
}

// ---------------------------------------------------------------- helpers --

/** Width of an element, kept up to date (charts draw at their real pixel width). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Rounds the max up to a tidy axis value (1, 2, 2.5, 5 × 10ⁿ). */
export function niceMax(v: number): number {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = {day: 'numeric', month: 'short'}) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', opts);

const MONTH: Intl.DateTimeFormatOptions = {month: 'short', year: 'numeric'};
const LONG_DAY: Intl.DateTimeFormatOptions = {weekday: 'short', day: 'numeric', month: 'short'};

/** "$1,234" (whole) or "$1,234.50": the default money format (VAREL's `money()` in USD). */
export const formatMoneyAmount = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Math.round(n * 100) / 100);

/** Axis money: "$0", "$500", "$2.5k". */
export const axisMoney = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`);

/** Arrow keys / Home / End / Esc move the readout across a chart's points. */
function useActivePoint(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!count) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const d = e.key === 'ArrowRight' ? 1 : -1;
        setActive(a => Math.min(count - 1, Math.max(0, (a ?? (d > 0 ? -1 : count)) + d)));
      } else if (e.key === 'Home') setActive(0);
      else if (e.key === 'End') setActive(count - 1);
      else if (e.key === 'Escape') setActive(null);
    },
    [count]
  );
  return {active, setActive, onKeyDown};
}

/** The floating label over the active point, moved through the CSSOM (CSP-safe). */
function ChartTip({left, width, children}: {left: number; width: number; children: ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.style.transform = `translateX(${Math.min(Math.max(left, 70), width - 70)}px)`;
  }, [left, width]);
  return (
    <div ref={ref} aria-hidden="true" className="chart-tip">
      <div className="chart-tip-box">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------ sales chart --

export interface SalesDay {
  /** ISO date (a day, or the first day of a month when `bucket="month"`). */
  date: string;
  /** Sales in currency units (not cents). */
  total: number;
  orders: number;
}

const H = 200; // plot height
const PAD = {top: 12, right: 8, bottom: 24, left: 48};
const GAP = 2; // surface gap between bars

/**
 * Revenue per day (or per month for long ranges), one series: ink bars on a
 * hairline grid, a hover / keyboard readout, a table fallback. `caption`
 * finishes "N orders …" and the labels; it defaults to "in the last N days".
 */
export function SalesChart({
  data,
  bucket = 'day',
  caption,
  format = n => formatMoneyAmount(n),
  axisFormat = axisMoney,
}: {
  data: SalesDay[];
  bucket?: 'day' | 'month';
  caption?: string;
  /** Money for the readout and the table. */
  format?: (n: number) => string;
  /** Money on the y axis (short). */
  axisFormat?: (n: number) => string;
}) {
  const monthly = bucket === 'month';
  const span = caption ?? `in the last ${data.length} days`;
  const unit = monthly ? 'month' : 'day';
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const {active, setActive, onKeyDown} = useActivePoint(data.length);
  const descId = useId();

  const max = useMemo(() => niceMax(Math.max(0, ...data.map(d => d.total))), [data]);
  const total = data.reduce((s, d) => s + d.total, 0);
  const orders = data.reduce((s, d) => s + d.orders, 0);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const step = data.length ? plotW / data.length : 0;
  const barW = Math.max(1, step - GAP);
  const y = (v: number) => PAD.top + H - (v / max) * H;
  const ticks = [0, max / 2, max];

  const cur = active !== null ? data[active] : null;
  const tipLeft = active !== null ? PAD.left + active * step + step / 2 : 0;
  const xLabelIdx = data.length ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [];

  return (
    <div className="sales-chart">
      {/* Readout: the hovered / focused day, or the period total. */}
      <div aria-live="polite" className="chart-readout">
        {cur ? (
          <>
            <span className="chart-readout-value">{format(cur.total)}</span>
            <span className="chart-readout-detail">
              {dayLabel(cur.date, monthly ? {month: 'long', year: 'numeric'} : LONG_DAY)} · {cur.orders} {cur.orders === 1 ? 'order' : 'orders'}
            </span>
          </>
        ) : (
          <>
            <span className="chart-readout-value">
              <CountUp value={total} format={n => format(Number.isInteger(total) ? Math.round(n) : Math.round(n * 100) / 100)} />
            </span>
            <span className="chart-readout-detail">
              {orders} {orders === 1 ? 'order' : 'orders'} {span}
            </span>
          </>
        )}
      </div>

      <div ref={wrapRef} className="chart-plot">
        {width > 0 ? (
          <svg
            width={width}
            height={H + PAD.top + PAD.bottom}
            role="img"
            aria-label={`Sales per ${unit} ${span}. Total ${format(total)}.`}
            aria-describedby={descId}
            tabIndex={0}
            className="chart-svg"
            onKeyDown={onKeyDown}
            onMouseLeave={() => setActive(null)}
            onBlur={() => setActive(null)}>
            {ticks.map(t => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  className={t === 0 ? 'chart-baseline' : 'chart-grid'}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">
                  {axisFormat(t)}
                </text>
              </g>
            ))}
            {/* Bars: 4px rounded top, square on the baseline. Keyed on the period so a switch regrows them. */}
            <g key={`${data.length}:${data[0]?.date}`}>
              {data.map((d, i) => {
                const x = PAD.left + i * step + GAP / 2;
                const h = Math.max(0, (d.total / max) * H);
                const r = Math.min(4, barW / 2, h);
                const top = PAD.top + H - h;
                const path =
                  h <= 0
                    ? ''
                    : `M${x},${PAD.top + H}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${PAD.top + H}Z`;
                return (
                  <g key={d.date}>
                    {path && (
                      <path
                        d={path}
                        // Left-to-right sweep, capped so 90 days still lands in under a second (CSSOM: CSP-safe).
                        ref={node => node?.style.setProperty('--d', `${Math.round((i / data.length) * 320)}ms`)}
                        className="chart-bar"
                        data-dim={active !== null && active !== i ? '' : undefined}
                      />
                    )}
                    {/* Hit target: the whole column. */}
                    <rect x={PAD.left + i * step} y={PAD.top} width={step} height={H} className="chart-hit" onMouseEnter={() => setActive(i)} />
                  </g>
                );
              })}
            </g>
            {xLabelIdx.map((i, k) => (
              <text
                key={`${i}-${k}`}
                x={PAD.left + i * step + step / 2}
                y={PAD.top + H + 16}
                textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
                className="chart-axis">
                {dayLabel(data[i]!.date, monthly ? MONTH : undefined)}
              </text>
            ))}
          </svg>
        ) : (
          <div className="chart-placeholder" />
        )}
        {cur && (
          <ChartTip left={tipLeft} width={width}>
            <span className="chart-tip-muted">{dayLabel(cur.date, monthly ? MONTH : undefined)}</span> {format(cur.total)}
          </ChartTip>
        )}
      </div>
      <p id={descId} className="visually-hidden">
        Use the left and right arrow keys to read each {unit}.
      </p>

      <details className="chart-table">
        <summary>View as table</summary>
        <div className="chart-table-scroll">
          <table>
            <caption className="visually-hidden">
              Sales per {unit} {span}
            </caption>
            <thead>
              <tr>
                <th scope="col">{monthly ? 'Month' : 'Date'}</th>
                <th scope="col" className="cell-end">
                  Orders
                </th>
                <th scope="col" className="cell-end">
                  Sales
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => (
                <tr key={d.date}>
                  <th scope="row">{dayLabel(d.date, monthly ? MONTH : LONG_DAY)}</th>
                  <td className="cell-end">{d.orders}</td>
                  <td className="cell-end">{format(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------- line chart --

export interface LinePoint {
  /** An ISO date (`YYYY-MM-DD`) or any short label. */
  label: string;
  value: number;
}

/**
 * One or two series over time (sessions, conversion, revenue by day): a line
 * with a soft area, a dashed comparison series, hover / keyboard readout and
 * a table. `format` writes a value for people; `axisFormat` the short axis.
 */
export function LineChart({
  data,
  compare,
  label,
  seriesLabel = 'This period',
  compareLabel = 'Previous period',
  format = n => n.toLocaleString('en-US'),
  axisFormat,
  height = 'md',
}: {
  data: LinePoint[];
  /** A second series of the same length (the period before), drawn dashed. */
  compare?: LinePoint[];
  /** What the chart shows, for screen readers and the table caption ("Sessions per day"). */
  label: string;
  seriesLabel?: string;
  compareLabel?: string;
  format?: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: 'sm' | 'md';
}) {
  const plotH = height === 'sm' ? 120 : 200;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const {active, setActive, onKeyDown} = useActivePoint(data.length);
  const descId = useId();
  const axis = axisFormat ?? format;

  const max = useMemo(() => niceMax(Math.max(0, ...data.map(d => d.value), ...(compare ?? []).map(d => d.value))), [data, compare]);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const x = (i: number) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const line = (points: LinePoint[]) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const main = data.length ? line(data) : '';
  const area = data.length ? `${main} L${x(data.length - 1).toFixed(1)} ${PAD.top + plotH} L${x(0).toFixed(1)} ${PAD.top + plotH} Z` : '';
  const ticks = [0, max / 2, max];
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s);
  const pointLabel = (s: string, opts?: Intl.DateTimeFormatOptions) => (isDate(s) ? dayLabel(s, opts) : s);
  const cur = active !== null ? data[active] : null;
  const xLabelIdx = data.length ? [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])] : [];

  return (
    <div className="line-chart">
      <div ref={wrapRef} className="chart-plot">
        {width > 0 ? (
          <svg
            width={width}
            height={plotH + PAD.top + PAD.bottom}
            role="img"
            aria-label={label}
            aria-describedby={descId}
            tabIndex={0}
            className="chart-svg"
            onKeyDown={onKeyDown}
            onMouseLeave={() => setActive(null)}
            onBlur={() => setActive(null)}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} strokeWidth={1} shapeRendering="crispEdges" />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">
                  {axis(t)}
                </text>
              </g>
            ))}
            {compare && compare.length === data.length && <path d={line(compare)} className="chart-line chart-line-compare" />}
            {area && <path d={area} className="chart-area" />}
            {main && <path d={main} className="chart-line" />}
            {cur && active !== null && (
              <>
                <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} className="chart-cursor" />
                <circle cx={x(active)} cy={y(cur.value)} r={4} className="chart-dot" />
              </>
            )}
            {data.map((p, i) => (
              <rect
                key={`${p.label}-${i}`}
                x={x(i) - (data.length > 1 ? plotW / (data.length - 1) / 2 : plotW / 2)}
                y={PAD.top}
                width={data.length > 1 ? plotW / (data.length - 1) : plotW}
                height={plotH}
                className="chart-hit"
                onMouseEnter={() => setActive(i)}
              />
            ))}
            {xLabelIdx.map((i, k) => (
              <text
                key={`${i}-${k}`}
                x={x(i)}
                y={PAD.top + plotH + 16}
                textAnchor={k === 0 ? 'start' : k === xLabelIdx.length - 1 ? 'end' : 'middle'}
                className="chart-axis">
                {pointLabel(data[i]!.label)}
              </text>
            ))}
          </svg>
        ) : (
          <div className={height === 'sm' ? 'chart-placeholder chart-placeholder-sm' : 'chart-placeholder'} />
        )}
        {cur && active !== null && (
          <ChartTip left={x(active)} width={width}>
            <span className="chart-tip-muted">{pointLabel(cur.label)}</span> {format(cur.value)}
            {compare?.[active] && (
              <>
                {' '}
                <span className="chart-tip-muted">· before {format(compare[active]!.value)}</span>
              </>
            )}
          </ChartTip>
        )}
      </div>
      {compare && (
        <p className="chart-legend" aria-hidden="true">
          <span className="chart-key" /> {seriesLabel} <span className="chart-key chart-key-compare" /> {compareLabel}
        </p>
      )}
      <p id={descId} className="visually-hidden">
        Use the left and right arrow keys to read each point.
      </p>
      <details className="chart-table">
        <summary>View as table</summary>
        <div className="chart-table-scroll">
          <table>
            <caption className="visually-hidden">{label}</caption>
            <thead>
              <tr>
                <th scope="col">{data.some(p => isDate(p.label)) ? 'Date' : 'Label'}</th>
                <th scope="col" className="cell-end">
                  {seriesLabel}
                </th>
                {compare && (
                  <th scope="col" className="cell-end">
                    {compareLabel}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((p, i) => (
                <tr key={`${p.label}-${i}`}>
                  <th scope="row">{pointLabel(p.label, LONG_DAY)}</th>
                  <td className="cell-end">{format(p.value)}</td>
                  {compare && <td className="cell-end">{compare[i] ? format(compare[i]!.value) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
