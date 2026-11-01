/* "How we make": three value columns (inlined in VAREL src/pages/Home.tsx). Server-rendered only. */
import {useText} from '@/components/varel/text';

import {type HomeProps, HomeText} from './island';
import {VALUES} from './sections';

function Values() {
  const t = useText('home');
  return (
    <section
      aria-label={t('values.label')}
      className="grid gap-10 px-6 py-16 md:grid-cols-3 md:gap-12 md:px-12 md:py-24">
      {VALUES.map(v => (
        <div key={v}>
          <h3 className="m-0 font-display text-display-5 font-normal">{t(`values.${v}.title`)}</h3>
          <p className="mt-3 mb-0 max-w-[34ch] text-body-sm text-text-secondary">{t(`values.${v}.body`)}</p>
        </div>
      ))}
    </section>
  );
}

export function HomeValues(props: HomeProps) {
  return (
    <HomeText {...props}>
      <Values />
    </HomeText>
  );
}
