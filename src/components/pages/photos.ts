/* Editorial photography for the About, Contact and 404 pages (Unsplash placeholders from the prototypes).
   VAREL src/pages/about/photos.ts + the studio photo of src/pages/contact/StudioDetails.tsx. */
import type {Photo} from '@/lib/types/common';

export const ABOUT_PHOTOS = {
  /** Studio interior — also used on the 404 page */
  hero: {
    src: 'https://images.unsplash.com/photo-1517502166878-35c93a0072f0',
    credit: 'Photo by Andrej Lišakov on Unsplash',
    creditHref: 'https://unsplash.com/@lishakov',
  },
  mill: {
    src: 'https://images.unsplash.com/photo-1613728455120-d00493b5e77e',
    credit: 'Photo by Hutomo Abrianto on Unsplash',
    creditHref: 'https://unsplash.com/@hutomoabrianto',
  },
} satisfies Record<string, Photo>;

export const STUDIO_PHOTO: Photo = {
  src: 'https://images.unsplash.com/photo-1713952852616-1827a2f0cf51',
  credit: 'Photo by همَّام on Unsplash',
  creditHref: 'https://unsplash.com/@pkseva',
};
