/*
 * The /styleguide/ catalogue (dev and Preview only, src/pages/styleguide.astro): every VAREL component with its
 * variants and states, interactive. One island; demo data only (no API calls except the newsletter form).
 */
import {type ReactNode, useState} from 'react';

import {ui} from '@/lib/stores/ui';

import {Badge, type BadgeTone} from './Badge';
import {Breadcrumb} from './Breadcrumb';
import {Button, type ButtonSize, type ButtonVariant} from './Button';
import {Card, type CardVariant} from './Card';
import {Checkbox} from './Checkbox';
import {ColorSwatch} from './ColorSwatch';
import {Container} from './Container';
import {Dialog} from './Dialog';
import {EmptyState} from './EmptyState';
import {Eyebrow, SectionHeading} from './Eyebrow';
import {Icon, ICONS, type IconName} from './Icon';
import {IconButton, type IconButtonVariant} from './IconButton';
import {Img} from './Img';
import {Input} from './Input';
import {NewsletterForm} from './NewsletterForm';
import {Price} from './Price';
import {ProductCard} from './ProductCard';
import {ProductGrid, ProductGridSkeleton} from './ProductGrid';
import {ProductMedia} from './ProductMedia';
import {ProductTile} from './ProductTile';
import {QuantityStepper} from './QuantityStepper';
import {Radio} from './Radio';
import {RichText} from './RichText';
import {Select} from './Select';
import {SizeSelector} from './SizeSelector';
import {Skeleton, TextSkeleton} from './Skeleton';
import {Spinner} from './Spinner';
import {Stars} from './Stars';
import {money, type Photo, type Swatch} from './support';
import {Switch} from './Switch';
import {Tabs} from './Tabs';
import {Tag} from './Tag';
import {type Dicts, TextProvider} from './text';
import {Textarea} from './Textarea';
import {notify, notifyError, Toast} from './Toast';
import {Tooltip} from './Tooltip';
import {Wordmark} from './Wordmark';

const PHOTO: Photo = {src: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f'};
const PHOTO_2: Photo = {src: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d'};
const SWATCHES: Swatch[] = [
  {name: 'Black', hex: '#1A1A1A'},
  {name: 'Stone', hex: '#CFC8BC'},
  {name: 'Olive', hex: '#5B5B3F'},
];
const RICH = `## Considered materials

Every VAREL piece is cut from **natural fibres** in small runs. Read more in the [journal](/journal/).

- Organic cotton
- Undyed wool
- Vegetable-tanned leather`;

function Section({id, title, children}: {id: string; title: string; children: ReactNode}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-hairline py-12">
      <h2 id={`${id}-title`} className="m-0 mb-8 font-display text-display-4 font-normal">
        {title}
      </h2>
      <div className="flex flex-col gap-8">{children}</div>
    </section>
  );
}

function Row({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow size="sm">{label}</Eyebrow>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </div>
  );
}

const SECTIONS = [
  ['type', 'Type & colour'],
  ['buttons', 'Buttons'],
  ['badges', 'Badges & tags'],
  ['forms', 'Forms'],
  ['navigation', 'Navigation'],
  ['feedback', 'Feedback'],
  ['commerce', 'Commerce'],
  ['layout', 'Layout helpers'],
  ['icons', 'Icons'],
] as const;

export function Styleguide({locale, dicts}: {locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Catalogue />
    </TextProvider>
  );
}

function Catalogue() {
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState('standard');
  const [switchOn, setSwitchOn] = useState(true);
  const [tab, setTab] = useState('details');
  const [size, setSize] = useState<string | null>('M');
  const [qty, setQty] = useState(1);
  const [color, setColor] = useState('Black');
  const [dialog, setDialog] = useState<'center' | 'right' | null>(null);
  const [email, setEmail] = useState('');
  const [wished, setWished] = useState(false);
  const [selectedTag, setSelectedTag] = useState(true);
  const [loading, setLoading] = useState(false);

  const variants: ButtonVariant[] = ['solid', 'outline', 'quiet', 'inverse'];
  const sizes: ButtonSize[] = ['sm', 'md', 'lg'];
  const tones: BadgeTone[] = ['ink', 'outline', 'quiet', 'positive', 'critical'];
  const cards: CardVariant[] = ['hairline', 'sunken', 'inverse', 'plain'];
  const iconButtons: IconButtonVariant[] = ['quiet', 'outline', 'solid'];

  return (
    <Container className="py-16">
      <SectionHeading
        as="h1"
        eyebrow="Design system"
        title="VAREL styleguide"
        description="Every storefront component, its variants and states. Dev and Preview only."
      />
      <nav aria-label="Sections" className="mt-8 mb-12 flex flex-wrap gap-x-6 gap-y-2">
        {SECTIONS.map(([id, title]) => (
          <a key={id} href={`#${id}`} className="text-label-md tracking-label uppercase">
            {title}
          </a>
        ))}
      </nav>

      <Section id="type" title="Type & colour">
        <Row label="Display">
          <div className="flex flex-col gap-2">
            <p className="m-0 font-display text-display-1">Display 1</p>
            <p className="m-0 font-display text-display-2">Display 2</p>
            <p className="m-0 font-display text-display-3">Display 3</p>
            <p className="m-0 font-display text-display-4">Display 4</p>
            <p className="m-0 font-display text-display-5">Display 5</p>
          </div>
        </Row>
        <Row label="Body & labels">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-body-lg">Body large: modern essentials, considered deeply.</p>
            <p className="m-0 text-body-md">Body medium: cut from natural fibres in small runs.</p>
            <p className="m-0 text-body-sm text-text-secondary">Body small, secondary.</p>
            <p className="m-0 text-body-xs text-text-muted">Body extra small, muted.</p>
            <p className="m-0 text-label-md tracking-label uppercase">Label medium</p>
            <p className="m-0 text-label-sm tracking-label uppercase">Label small</p>
          </div>
        </Row>
        <Row label="Ink scale">
          {['bg-ink-000 border border-hairline', 'bg-ink-100', 'bg-ink-300', 'bg-ink-400', 'bg-ink-500', 'bg-ink-900', 'bg-chalk', 'bg-surface-page border border-hairline'].map(
            c => (
              <span key={c} className={`block size-14 ${c}`} title={c} />
            )
          )}
        </Row>
      </Section>

      <Section id="buttons" title="Buttons">
        {variants.map(v => (
          <Row key={v} label={`Button · ${v}`}>
            <div className={v === 'inverse' ? 'flex flex-wrap gap-4 bg-ink-900 p-4' : 'flex flex-wrap gap-4'}>
              {sizes.map(s => (
                <Button key={s} variant={v} size={s}>
                  {s === 'sm' ? 'Small' : s === 'md' ? 'Add to bag' : 'Continue to checkout'}
                </Button>
              ))}
              <Button variant={v} disabled>
                Disabled
              </Button>
              <Button variant={v} loading loadingLabel="Adding…">
                Add
              </Button>
            </div>
          </Row>
        ))}
        <Row label="Pending on click · link · full width">
          <Button
            loading={loading}
            loadingLabel="Saving…"
            onClick={() => {
              setLoading(true);
              window.setTimeout(() => setLoading(false), 1500);
            }}>
            Save
          </Button>
          <Button href="#buttons" variant="outline">
            Link button
          </Button>
          <div className="w-full max-w-sm">
            <Button fullWidth>Full width</Button>
          </div>
        </Row>
        <Row label="IconButton">
          {iconButtons.map(v => (
            <IconButton key={v} name="heart" label={`Wishlist (${v})`} variant={v} />
          ))}
          <IconButton name="x" label="Close" disabled />
        </Row>
      </Section>

      <Section id="badges" title="Badges & tags">
        <Row label="Badge tones">
          {tones.map(t => (
            <Badge key={t} tone={t}>
              {t}
            </Badge>
          ))}
        </Row>
        <Row label="Tag">
          <Tag selected={selectedTag} onClick={() => setSelectedTag(s => !s)}>
            Selected (click)
          </Tag>
          <Tag>Outerwear</Tag>
          <Tag removable onRemove={() => notify('Filter removed')}>
            Removable
          </Tag>
        </Row>
      </Section>

      <Section id="forms" title="Forms">
        <div className="grid max-w-3xl gap-6 md:grid-cols-2">
          <Input label="Email" type="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} hint="We never share it." />
          <Input label="Postcode" value="00" error="Enter a 4-digit postcode, like 2200." onChange={() => {}} />
          <Input label="Disabled" value="Copenhagen" disabled onChange={() => {}} />
          <Select
            label="Country"
            defaultValue="DK"
            options={[
              {value: 'DK', label: 'Denmark'},
              {value: 'SE', label: 'Sweden'},
              {value: 'DE', label: 'Germany'},
            ]}
          />
          <Textarea label="Message" placeholder="How can we help?" className="md:col-span-2" />
        </div>
        <Row label="Checkbox · Radio · Switch">
          <Checkbox checked={checked} onCheckedChange={setChecked} label="Remember me" />
          <Checkbox checked={false} label="With count" count={12} onCheckedChange={() => {}} />
          <Checkbox checked disabled label="Disabled" />
          <Radio name="ship" value="standard" checked={radio === 'standard'} onChange={() => setRadio('standard')} label="Standard" />
          <Radio name="ship" value="express" checked={radio === 'express'} onChange={() => setRadio('express')} label="Express" />
          <Switch checked={switchOn} onChange={setSwitchOn} label="Analytics cookies" />
        </Row>
      </Section>

      <Section id="navigation" title="Navigation">
        <Row label="Tabs">
          <Tabs
            label="Product information"
            value={tab}
            onChange={setTab}
            items={[
              {value: 'details', label: 'Details'},
              {value: 'care', label: 'Care'},
              {value: 'shipping', label: 'Shipping'},
            ]}
          />
        </Row>
        <Row label="Breadcrumb">
          <Breadcrumb items={[{label: 'Home', href: '/'}, {label: 'Women', href: '/shop/women/'}, 'Coats']} />
        </Row>
      </Section>

      <Section id="feedback" title="Feedback">
        <Row label="Dialog">
          <Button variant="outline" onClick={() => setDialog('center')}>
            Open dialog
          </Button>
          <Button variant="outline" onClick={() => setDialog('right')}>
            Open side panel
          </Button>
          <Button variant="outline" onClick={ui.openBag}>
            Open bag drawer
          </Button>
          <Dialog
            open={dialog !== null}
            placement={dialog ?? 'center'}
            title={dialog === 'right' ? 'Size guide' : 'Remove item?'}
            description="A VAREL dialog."
            onClose={() => setDialog(null)}
            footer={
              <Button fullWidth onClick={() => setDialog(null)}>
                Done
              </Button>
            }>
            <p className="m-0 text-body-md">Dialog content sits here. Esc or the close button dismisses it.</p>
          </Dialog>
        </Row>
        <Row label="Toast">
          <Toast message="Added to bag" action="View bag" />
          <Toast message="Could not save" tone="quiet" icon={null} />
          <Button variant="outline" onClick={() => notify('Added to bag', {action: 'View bag', onAction: ui.openBag})}>
            Show toast
          </Button>
          <Button variant="outline" onClick={() => notifyError('Something went wrong. Please try again.')}>
            Show error toast
          </Button>
        </Row>
        <Row label="Tooltip · Spinner · Stars">
          <Tooltip content="Ships in 2–4 days">
            <span className="text-body-md underline">Hover me</span>
          </Tooltip>
          <Spinner />
          <Spinner size={24} label="Loading" />
          <Stars value={4.5} label="4.5 out of 5" />
        </Row>
        <Row label="Skeleton">
          <div className="flex w-full max-w-md flex-col gap-4">
            <Skeleton className="h-40 w-full" />
            <TextSkeleton lines={3} />
          </div>
        </Row>
        <Row label="EmptyState">
          <EmptyState
            bordered
            title="Your wishlist is empty"
            description="Tap the heart on any piece to keep it here."
            action={<Button href="/shop/">Shop all</Button>}
            className="w-full"
          />
        </Row>
      </Section>

      <Section id="commerce" title="Commerce">
        <Row label="Price">
          <Price amount={money(148)} />
          <Price amount={money(98)} compareAt={money(148)} size="lg" />
          <Price amount={money(24.6)} size="sm" />
        </Row>
        <Row label="ColorSwatch · SizeSelector · QuantityStepper">
          {SWATCHES.map(s => (
            <ColorSwatch key={s.name} color={s.hex} label={s.name} selected={color === s.name} onClick={() => setColor(s.name)} />
          ))}
          <SizeSelector label="Size" sizes={['XS', 'S', 'M', 'L', 'XL']} soldOut={['XS']} value={size} onChange={setSize} />
          <QuantityStepper value={qty} min={1} max={5} onChange={setQty} itemLabel="Wool overcoat" />
        </Row>
        <Row label="ProductTile (full, compact) · ProductCard">
          <ProductGrid columns={3} className="w-full">
            <ProductTile
              name="Wool overcoat"
              href="#commerce"
              photo={PHOTO}
              price={money(420)}
              compareAt={money(520)}
              onSale
              meta="Women · Coats · Wool"
              badge="New"
              promotion="20% off outerwear"
              rating={{avg: 4.6, count: 18}}
              swatches={SWATCHES}
              selectedColor={color}
              onSelectColor={setColor}
              stock="low"
              stockLabel="Only 2 left"
              wished={wished}
              onWish={() => setWished(w => !w)}
              wishLabel="Save to wishlist"
              onAdd={() => notify('Added to bag', {action: 'View bag', onAction: ui.openBag})}
              addLabel="Quick add"
            />
            <ProductTile variant="compact" name="Linen shirt" href="#commerce" photo={PHOTO_2} price={money(140)} meta="Men · Shirts" stock="out" stockLabel="Sold out" addDisabled />
            <ProductCard name="Canvas tote" category="Bags" price={money(90)} colors={['#1A1A1A', '#CFC8BC']} badge="Limited" photo={PHOTO} href="#commerce" />
          </ProductGrid>
        </Row>
        <Row label="ProductMedia · Img ratios">
          <div className="grid w-full grid-cols-2 gap-4 md:grid-cols-4">
            <ProductMedia photo={PHOTO} caption="3/4 product" />
            <Img photo={PHOTO_2} ratio="4/5" alt="" />
            <div className="col-span-2">
              <Img photo={PHOTO} ratio="16/9" alt="" />
            </div>
          </div>
        </Row>
        <Row label="ProductGridSkeleton">
          <ProductGridSkeleton count={4} columns={4} className="w-full" />
        </Row>
      </Section>

      <Section id="layout" title="Layout helpers">
        <Row label="Wordmark · Eyebrow">
          <Wordmark size={24} href={null} />
          <Wordmark size={20} href="/" />
          <Eyebrow>Eyebrow</Eyebrow>
          <Eyebrow tone="secondary" size="lg">
            Eyebrow large
          </Eyebrow>
        </Row>
        <Row label="Card variants">
          <div className="grid w-full gap-4 md:grid-cols-4">
            {cards.map(v => (
              <Card key={v} variant={v} padding="24px">
                <p className="m-0 text-body-md">{v}</p>
              </Card>
            ))}
          </div>
        </Row>
        <Row label="RichText">
          <RichText text={RICH} className="max-w-prose" />
        </Row>
        <Row label="NewsletterForm (default · inverse)">
          <div className="grid w-full gap-6 md:grid-cols-2">
            <NewsletterForm source="styleguide" />
            <div className="bg-ink-900 p-6">
              <NewsletterForm source="styleguide" tone="inverse" />
            </div>
          </div>
        </Row>
      </Section>

      <Section id="icons" title="Icons">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6 lg:grid-cols-10">
          {(Object.keys(ICONS) as IconName[]).map(name => (
            <div key={name} className="flex flex-col items-center gap-2 border border-hairline p-3 text-center">
              <Icon name={name} />
              <span className="text-body-xs break-all text-text-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>
    </Container>
  );
}
