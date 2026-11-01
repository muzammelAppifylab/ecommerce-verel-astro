/* VAREL component library: faithful ports of the VAREL design handoff components plus helpers, for storefront
   React islands. Import from '@/components/varel'. Every component is CSP-safe (no style="" in server HTML).
   See /styleguide/ (dev only) for the catalogue. */

// Core
export {Button, buttonClasses, type ButtonProps, type ButtonVariant, type ButtonSize} from './Button';
export {IconButton, type IconButtonProps, type IconButtonVariant} from './IconButton';
export {Icon, ICONS, type IconName, type IconProps} from './Icon';
export {Card, type CardProps, type CardVariant} from './Card';
export {Badge, type BadgeProps, type BadgeTone} from './Badge';
export {Tag, type TagProps} from './Tag';

// Forms
export {Input, type InputProps} from './Input';
export {Textarea, type TextareaProps} from './Textarea';
export {Select, type SelectProps, type SelectOption} from './Select';
export {Checkbox, type CheckboxProps} from './Checkbox';
export {Radio, type RadioProps} from './Radio';
export {Switch, type SwitchProps} from './Switch';

// Navigation
export {Tabs, type TabsProps, type TabItem} from './Tabs';
export {Breadcrumb, type BreadcrumbProps, type BreadcrumbItem} from './Breadcrumb';

// Feedback
export {Dialog, type DialogProps} from './Dialog';
export {Toast, Toaster, notify, notifyError, type ToastProps, type NotifyOptions} from './Toast';
export {Tooltip, type TooltipProps} from './Tooltip';
export {Spinner, type SpinnerProps} from './Spinner';
export {Skeleton, TextSkeleton} from './Skeleton';
export {EmptyState, type EmptyStateProps} from './EmptyState';

// Commerce
export {ProductCard, type ProductCardProps} from './ProductCard';
export {ProductTile, promotionNote, type ProductTileProps} from './ProductTile';
export {ProductGridItem, type ProductGridItemProps} from './ProductGridItem';
export {ProductGrid, ProductGridSkeleton, ProductTileSkeleton, type ProductGridProps} from './ProductGrid';
export {ProductMedia, type ProductMediaProps} from './ProductMedia';
export {ColorSwatch, type ColorSwatchProps} from './ColorSwatch';
export {SizeSelector, type SizeSelectorProps} from './SizeSelector';
export {QuantityStepper, type QuantityStepperProps} from './QuantityStepper';
export {Price, type PriceProps} from './Price';
export {Stars} from './Stars';

// Layout helpers
export {Wordmark, type WordmarkProps} from './Wordmark';
export {Eyebrow, SectionHeading, type EyebrowProps, type SectionHeadingProps} from './Eyebrow';
export {Container, type ContainerProps} from './Container';
export {Img, type ImgProps, type ImgRatio} from './Img';
export {NewsletterForm, type NewsletterFormProps} from './NewsletterForm';
export {RichText, type RichTextProps} from './RichText';

// Words, links, helpers
export {TextProvider, useText, useLocale, translate, mergeDicts, interpolate, type Dict, type Dicts, type Translate} from './text';
export {localizeHref, stripLocale, isActivePath, isExternalUrl, DEFAULT_LOCALE, SHIPPED_LOCALES} from './href';
export {useElementStyle} from './element-style';
export * from './support';
