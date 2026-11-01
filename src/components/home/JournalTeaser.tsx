/* "From the journal": the three latest posts (port of VAREL src/pages/home/JournalTeaser.tsx).
   Server-rendered only; the page leaves it out when the posts failed or there are none. */
import {Img} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {dotJoin} from '@/lib/format';
import {journalLink, postLink} from '@/lib/links';
import type {Post} from '@/lib/types/content';

import {type HomeProps, HomeText} from './island';

function Teaser({posts}: {posts: Post[]}) {
  const t = useText('home');
  const locale = useLocale();
  return (
    <section id="journal" className="border-t border-hairline px-6 py-16 md:px-12 md:py-24">
      <div className="mb-8 flex items-baseline justify-between gap-6">
        <h2 className="m-0 font-display text-display-4 font-normal">{t('journal.title')}</h2>
        <a href={journalLink(locale)} className="border-0 text-label-md tracking-label uppercase">
          {t('journal.all')}
        </a>
      </div>
      <div className="grid gap-x-5 gap-y-12 md:grid-cols-3">
        {posts.map(post => (
          <a key={post.slug} href={postLink(post.slug, locale)} className="flex flex-col gap-4 border-0">
            <div className="relative aspect-video overflow-hidden bg-ink-100">
              <Img
                photo={post.image}
                alt={post.title}
                ratio="fill"
                width={900}
                sizes="(min-width: 768px) 33vw, 100vw"
                media={false}
              />
            </div>
            <span className="text-label-sm tracking-label text-text-muted uppercase">
              {dotJoin(post.categoryLabel ?? post.category, post.read)}
            </span>
            <h3 className="m-0 font-display text-display-5 font-normal">{post.title}</h3>
            <p className="m-0 text-body-sm text-text-secondary">{post.excerpt}</p>
          </a>
        ))}
      </div>
    </section>
  );
}

/** At most the three newest of `posts` (the route answers newest first). */
export function JournalTeaser({posts, ...props}: HomeProps & {posts: Post[]}) {
  return (
    <HomeText {...props}>
      <Teaser posts={posts.slice(0, 3)} />
    </HomeText>
  );
}
