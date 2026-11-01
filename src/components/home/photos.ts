/* Editorial (non-commerce) photography used by the home page: Unsplash placeholders from the prototype
   (port of VAREL src/pages/home/photos.ts). Product and journal images come from the API. */
import type {Photo} from '../../lib/types/common';

const u = (id: string, name: string, handle: string): Photo => ({
  src: id.startsWith('http') ? id : `https://images.unsplash.com/photo-${id}`,
  credit: `Photo by ${name} on Unsplash`,
  creditHref: `https://unsplash.com/@${handle}`,
});

export const HOME_PHOTOS = {
  // The studio's own campaign photo (public/images, 2000px): knitwear, a wool coat and linen on a pale rail.
  hero: {src: '/images/hero-studio-rail.jpg', credit: 'VAREL', creditHref: '/'} as Photo,
  featureA: u('1715536369840-9e314f847d78', 'Gabriel Martin', 'diseniatica'),
  featureB: u('1613728455120-d00493b5e77e', 'Hutomo Abrianto', 'hutomoabrianto'),
  bestPart: u('1750603247133-1fd1b4e4aca4', 'Samuel Sng', 'samuelsngx'),
  new1a: u('1646270968752-c2cbdb8e7f73', 'Meg MacDonald', 'missmeg_mac'),
  new1b: u('1654521883301-070279dd0ae1', 'Voska Studio', 'voskastudio'),
  new2a: u('1558769132-cb1aea458c5e', 'Alyssa Strohmann', 'anotherlovely'),
  new2b: u('1633655442432-620aa55d7ac1', 'Yasamine June', 'yasamine'),
  collectionsA: u('1523205565295-f8e91625443b', 'Mark West', 'markwest_'),
  collectionsB: u('1633655442432-620aa55d7ac1', 'Yasamine June', 'yasamine'),
};

/** Department tiles in "Shop by category": art direction per department slug. */
export const DEPT_PHOTOS: Record<string, Photo> = {
  women: u('https://images.unsplash.com/flagged/photo-1585052201332-b8c0ce30972f', 'MariaBeatrice Alonzi', 'mariabeatrice'),
  men: u('https://images.unsplash.com/photo-1518575139326-8c3b3d3d074c', 'Velizar Ivanov', 'lycan'),
  shoes: u('1516762689617-e1cffcef479d', 'Heather Ford', 'the_modern_life_mrs'),
  bags: u('1517502166878-35c93a0072f0', 'Andrej Lišakov', 'lishakov'),
  accessories: u('1654521883301-070279dd0ae1', 'Voska Studio', 'voskastudio'),
  lifestyle: u('1633972767447-5098f0322a45', 'Katya Azimova', '_katishna_'),
};
