/* The two interactive pieces of the (server-rendered) footer, each a small island. */
import {NewsletterForm} from '@/components/varel/NewsletterForm';
import {type Dicts, TextProvider} from '@/components/varel/text';

import {type LanguageChoice, LanguageSwitcher} from './LanguageSwitcher';

/** Footer newsletter (client:visible): underlined email + Subscribe on obsidian, `source: "footer"`. */
export function FooterNewsletter({locale, dicts}: {locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <NewsletterForm source="footer" tone="inverse" />
    </TextProvider>
  );
}

/** Footer legal-bar language control (client:visible): "Language · English" opening upward. */
export function FooterLanguage({
  locale,
  dicts,
  languages,
  signedIn,
}: {
  locale: string;
  dicts: Dicts;
  languages: LanguageChoice[];
  signedIn: boolean;
}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <LanguageSwitcher variant="footer" languages={languages} current={locale} signedIn={signedIn} />
    </TextProvider>
  );
}
