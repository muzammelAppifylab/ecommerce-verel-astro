/*
 * A CMS page body rendered from PostBlock[] (server HTML, no client JS): port of VAREL
 * `src/pages/journal/PostBody.tsx`, kept here so the CMS pages do not wait on the journal package (WP-06);
 * classes and heading ids are the same as the journal's, so both render alike.
 * 62ch measure, Cormorant subheads, chalk pull quotes; the first paragraph is the 18px standfirst.
 */
import {Img} from '@/components/varel/Img';
import {slugify} from '@/lib/format';
import type {PostBlock} from '@/lib/types/content';

export function PageBody({body}: {body: PostBlock[]}) {
  const firstP = body.findIndex(b => b.type === 'p');
  return (
    <div className="flex max-w-[62ch] min-w-0 flex-col gap-7">
      {body.map((b, i) => {
        switch (b.type) {
          case 'p':
            return i === firstP ? (
              <p key={i} className="m-0 text-[17px] leading-[1.7] text-text-primary md:text-[18px]">
                {b.text}
              </p>
            ) : (
              <p key={i} className="m-0 text-body-md leading-[1.7] text-text-secondary">
                {b.text}
              </p>
            );
          case 'h2':
            return (
              <h2 key={i} id={slugify(b.text)} className="m-0 mt-5 scroll-mt-24 font-display text-[28px] leading-[1.1] font-normal tracking-normal md:text-[34px]">
                {b.text}
              </h2>
            );
          case 'quote':
            return <Quote key={i} text={b.text} cite={b.cite} />;
          case 'list':
            return (
              <ul key={i} className="m-0 flex list-disc flex-col gap-3 pl-[22px] text-body-md leading-[1.7] text-text-secondary">
                {b.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            );
          case 'image':
            return <Figure key={i} block={b} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

export function Quote({text, cite}: {text: string; cite?: string}) {
  return (
    <blockquote className="mx-0 my-5 bg-chalk px-6 py-6 font-display text-[22px] leading-[1.3] md:px-8 md:py-7 md:text-[26px]">
      <p className="m-0">“{text.replace(/^[“"]|[”"]$/g, '')}”</p>
      {cite && <footer className="mt-4 font-sans text-[11px] leading-snug tracking-label text-text-muted uppercase">{cite}</footer>}
    </blockquote>
  );
}

export function Figure({block}: {block: Extract<PostBlock, {type: 'image'}>}) {
  return (
    <figure className="m-0 my-2 flex flex-col gap-3">
      <Img photo={block.image} alt={block.caption ?? ''} ratio="4/5" width={900} sizes="(min-width: 768px) 62ch, 100vw" />
      {block.caption && <figcaption className="text-body-xs text-text-muted">{block.caption}</figcaption>}
    </figure>
  );
}
