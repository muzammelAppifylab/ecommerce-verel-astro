/*
 * /contact — email topics on the left, studio details and FAQ on the right. Port of VAREL
 * `src/pages/Contact.tsx`, `contact/ContactTopics.tsx` and `contact/StudioDetails.tsx`, as server HTML
 * (no client JS): the topics are `mailto:` links built on the server.
 */
import {Breadcrumb} from '@/components/varel/Breadcrumb';
import {Icon} from '@/components/varel/Icon';
import {Img} from '@/components/varel/Img';
import {TextProvider, useLocale, useText, type Dicts} from '@/components/varel/text';
import {href} from '@/lib/links';

import {STUDIO_PHOTO} from './photos';
import {CONTACT_TOPICS, type StudioContact, topicMailto} from './policy';

/** FAQ entries: `contact:faq.<key>Q` / `contact:faq.<key>A`. */
const FAQS = ['where', 'size', 'repair', 'wholesale'] as const;

const LABEL = 'text-[11px] leading-snug tracking-label uppercase text-text-muted';
const SMALL_LINK = 'border-b border-strong pb-[3px] text-[11px] leading-snug tracking-label uppercase';

/** One row per topic; each opens the visitor's email app with the subject filled in. */
function ContactTopics({contact}: {contact: StudioContact}) {
  const t = useText('contact');
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-body-sm text-text-secondary">{t('write.hint')}</p>
      <ul className="m-0 flex list-none flex-col border-t border-hairline p-0">
        {CONTACT_TOPICS.map(topic => (
          <li key={topic.value} className="border-b border-hairline">
            <a
              href={topicMailto(contact.email, topic.label, topic.order)}
              className="group flex items-center justify-between gap-4 border-0 py-[18px] text-[15px] text-text-primary hover:text-text-primary">
              {t(`subjects.${topic.value}`)}
              <Icon name="arrow-up-right" size={16} className="shrink-0 text-text-muted transition-hover group-hover:text-text-primary" />
            </a>
          </li>
        ))}
      </ul>
      <p className="m-0 text-body-sm text-text-secondary">
        {t('write.direct')} <a href={`mailto:${contact.email}`}>{contact.email}</a>
      </p>
    </div>
  );
}

/** Studio photo, address / hours / email / phone on chalk, and the "Before you write" FAQ. */
function StudioDetails({contact}: {contact: StudioContact}) {
  const t = useText('contact');
  const locale = useLocale();
  return (
    <section aria-label={t('studio.label')} className="flex flex-col gap-0.5">
      <Img photo={STUDIO_PHOTO} alt={t('studio.photoAlt')} ratio="16/9" width={1200} sizes="(min-width: 1024px) 45vw, 100vw" />

      <div className="grid grid-cols-1 gap-8 bg-chalk p-6 sm:grid-cols-2 md:p-9">
        <div className="flex flex-col gap-2.5">
          <span className={LABEL}>{t('studio.studio')}</span>
          <span className="text-[15px] leading-body">
            {(contact.addressLines ?? [t('studio.addressLine1'), t('studio.addressLine2')]).map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          <span className={LABEL}>{t('studio.hours')}</span>
          <span className="text-[15px] leading-body">
            {t('studio.days')}
            <br />
            {t('studio.time')}
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          <span className={LABEL}>{t('studio.email')}</span>
          <a href={`mailto:${contact.email}`} className="self-start text-[15px]">
            {contact.email}
          </a>
        </div>
        <div className="flex flex-col gap-2.5">
          <span className={LABEL}>{t('studio.phone')}</span>
          <a href={contact.phoneHref} className="self-start border-0 text-[15px] text-text-primary">
            {contact.phone}
          </a>
        </div>
      </div>

      <div className="mt-[26px] flex flex-col gap-[22px] border border-hairline p-6 md:p-9">
        <h2 className="m-0 font-display text-[28px] font-normal tracking-normal">{t('faq.title')}</h2>
        {FAQS.map(f => (
          <div key={f} className="flex flex-col gap-2 border-t border-hairline pt-[18px]">
            <span className="text-[15px]">{t(`faq.${f}Q`)}</span>
            <span className="text-body-sm text-text-secondary">{t(`faq.${f}A`)}</span>
          </div>
        ))}
        <div className="flex flex-wrap gap-5">
          <a href={href('/returns/', locale)} className={SMALL_LINK}>
            {t('faq.returns')}
          </a>
          <a href={href('/account/orders/', locale)} className={SMALL_LINK}>
            {t('faq.track')}
          </a>
          <a href={href('/terms/', locale)} className={SMALL_LINK}>
            {t('faq.terms')}
          </a>
        </div>
      </div>
    </section>
  );
}

function ContactContent({contact}: {contact: StudioContact}) {
  const t = useText('contact');
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-page">
      <Breadcrumb className="px-6 pt-6 md:px-12" items={[{label: t('home'), href: href('/', locale)}, {label: t('title')}]} />
      <div className="grid grid-cols-1 items-start gap-14 px-6 pt-8 pb-16 md:px-12 md:pb-24 lg:grid-cols-2 lg:gap-20">
        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h1 className="m-0 font-display text-[40px] leading-tight font-normal tracking-display md:text-[52px]">{t('title')}</h1>
            <p className="m-0 max-w-[46ch] text-body-md text-text-secondary">{t('intro')}</p>
          </div>
          <ContactTopics contact={contact} />
        </section>
        <StudioDetails contact={contact} />
      </div>
    </div>
  );
}

export function ContactView({locale, dicts, contact}: {locale: string; dicts: Dicts; contact: StudioContact}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <ContactContent contact={contact} />
    </TextProvider>
  );
}
