import type {Photo} from '@/components/varel/support';

/** Editorial images used by the auth pages (VAREL `layout/AuthLayout.tsx` AUTH_IMAGES; Img appends size params). */
export const AUTH_IMAGES = {
  login: {
    src: 'https://images.unsplash.com/photo-1518575139326-8c3b3d3d074c',
    credit: 'Photo by Velizar Ivanov on Unsplash',
    creditHref: 'https://unsplash.com/@lycan',
  },
  signup: {
    src: 'https://images.unsplash.com/photo-1646270968752-c2cbdb8e7f73',
    credit: 'Photo by Meg MacDonald on Unsplash',
    creditHref: 'https://unsplash.com/@missmeg_mac',
  },
  reset: {
    src: 'https://images.unsplash.com/photo-1633972767447-5098f0322a45',
    credit: 'Photo by Katya Azimova on Unsplash',
    creditHref: 'https://unsplash.com/@_katishna_',
  },
} satisfies Record<string, Photo>;
