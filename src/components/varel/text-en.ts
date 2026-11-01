/* English source strings for the namespaces the design system and shell use, copied verbatim from VAREL
   src/locales/en/{common,layout,i18n,privacy,journal,product}.json (only the keys used here). They are the
   fallback under the catalogs in src/locales (F4): a key missing from a catalog still reads in English. */
import type {Dicts} from './text';

export const EN_FALLBACK: Dicts = {
  "common": {
    "addToBag": "Add to bag",
    "remove": "Remove",
    "save": "Save",
    "cancel": "Cancel",
    "continue": "Continue",
    "close": "Close",
    "back": "Back",
    "loading": "Loading",
    "tryAgain": "Try again",
    "error": "Something went wrong. Please try again.",
    "free": "Free",
    "soldOut": "Sold out",
    "quantity": "Quantity",
    "size": "Size",
    "colour": "Colour",
    "search": "Search",
    "signIn": "Sign in",
    "viewAll": "View all",
    "apply": "Apply"
  },
  "layout": {
    "announcement": {
      "fallback": "Free shipping on orders over $150"
    },
    "skipLink": "Skip to content",
    "header": {
      "departments": "Departments",
      "accountAndBag": "Account and bag",
      "openMenu": "Open menu",
      "search": "Search",
      "account": "Account",
      "wishlist": "Wishlist ({{count}})",
      "bag": "Bag ({{count}})",
      "bagShort": "Bag ({{count}})",
      "openBag_one": "Open bag, {{count}} items",
      "openBag_other": "Open bag, {{count}} items"
    },
    "mobileMenu": {
      "title": "Menu",
      "description": "Site navigation",
      "allProducts": "All products",
      "signIn": "Sign in"
    },
    "menu": {
      "labels": {
        "women": "Women",
        "men": "Men",
        "shoes": "Shoes",
        "bags": "Bags",
        "journal": "Journal",
        "about": "About",
        "contact": "Contact",
        "allProducts": "All products",
        "bag": "Bag",
        "signIn": "Sign in",
        "orders": "Orders",
        "returns": "Returns",
        "menu": "Menu",
        "shop": "Shop",
        "account": "Account"
      }
    },
    "footer": {
      "newsletterTitle": "A letter from the studio, twice a month",
      "newsletterBody": "New pieces, restocks and notes from the studio. Nothing else.",
      "studio": "Studio",
      "addressLine1": "112 Studio, Nørrebro",
      "addressLine2": "0000 Copenhagen, Denmark",
      "newTab": "(opens in a new tab)",
      "copyright": "© {{year}} VAREL. Designed in Copenhagen, made in Europe. Less, but better.",
      "vat": "VAT {{number}}",
      "terms": "Terms & conditions",
      "privacy": "Privacy policy"
    },
    "bag": {
      "title": "Your bag ({{count}})",
      "description": "Items in your bag",
      "emptyTitle": "Your bag is empty.",
      "emptyBody": "Nothing in it yet. The autumn edit is a good place to start.",
      "continueShopping": "Continue shopping",
      "freeShippingWith": "Free shipping · {{name}}",
      "toFree": "{{amount}} away from free shipping",
      "freeApplied": "Free shipping applied",
      "digital": "Digital",
      "remove": "Remove",
      "removeItem": "Remove {{name}}",
      "codeSaved": "{{code}} saved · not applied yet",
      "subtotal": "Subtotal",
      "shipping": "Shipping",
      "checkout": "Checkout",
      "viewBag": "View bag",
      "taxesNote": "Shipping and taxes calculated at checkout."
    },
    "checkout": {
      "backToBag": "← Back to bag",
      "secure": "Secure checkout"
    },
    "error": {
      "title": "Something went wrong",
      "heading": "Something went wrong.",
      "body": "This page did not load. Try again, or start from the collection.",
      "tryAgain": "Try again",
      "shop": "Shop the collection"
    },
    "ui": {
      "breadcrumb": "Breadcrumb",
      "decrease": "Decrease",
      "increase": "Increase",
      "decreaseOf": "Decrease quantity of {{name}}",
      "increaseOf": "Increase quantity of {{name}}",
      "removeTag": "Remove {{name}}",
      "home": "VAREL home",
      "photoCredit": "Photo by {{name}} on Unsplash"
    }
  },
  "i18n": {
    "language": "Language",
    "choose": "Choose language",
    "current": "Language: {{name}}",
    "changed": "Language changed"
  },
  "privacy": {
    "banner": {
      "label": "Cookie consent",
      "title": "Cookies",
      "body": "We use necessary cookies to keep your bag, wishlist and sign-in working. With your permission we also count visits to learn what to make next.",
      "privacyLink": "Privacy policy",
      "acceptAll": "Accept all",
      "necessaryOnly": "Necessary only",
      "settings": "Settings"
    },
    "dialog": {
      "title": "Cookie settings",
      "description": "Choose which cookies VAREL may use",
      "save": "Save choices",
      "acceptAll": "Accept all",
      "intro": "Necessary cookies are always on. Everything else waits for your permission, and you can change your mind here at any time.",
      "necessaryTitle": "Necessary",
      "necessaryBody": "Keep your bag, wishlist, checkout and sign-in working. They cannot be switched off.",
      "necessarySwitch": "Necessary cookies, always on",
      "analyticsTitle": "Analytics",
      "analyticsBody": "Count page and product views so we learn what people look for. No advertising, never shared or sold.",
      "analyticsSwitch": "Analytics cookies"
    },
    "settingsLink": "Cookie settings"
  },
  "journal": {
    "newsletterForm": {
      "note": "We never share your address.",
      "success": "Thank you. The next letter will reach your inbox.",
      "invalidEmail": "Enter a valid email address.",
      "emailLabel": "Email address",
      "subscribe": "Subscribe",
      "sending": "Sending",
      "subscribed": "Subscribed"
    }
  },
  "product": {
    "tile": {
      "addToBag": "Add to bag",
      "addedToBag": "Added to bag",
      "soldOut": "Sold out",
      "download": "Download",
      "notifyMe": "View details",
      "added": "Added",
      "quickAdd": "Quick add",
      "soldOutDetails": "{{name}} is sold out. View details",
      "addNameToBag": "Add {{name}} to bag",
      "addToWishlist": "Add to wishlist",
      "removeFromWishlist": "Remove from wishlist",
      "addNameToWishlist": "Add {{name}} to wishlist",
      "removeNameFromWishlist": "Remove {{name}} from wishlist",
      "rated": "Rated {{avg}} out of 5",
      "promotionInBag": "{{label}} in your bag",
      "bagWord": "bag"
    },
    "stock": {
      "inStock": "In stock",
      "lowLeft_one": "Only {{count}} left",
      "lowLeft_other": "Only {{count}} left",
      "instantDownload": "Instant download",
      "soldOutSize": "Sold out in this size",
      "backorder": "Made to order · ships in 2–3 weeks",
      "digitalNoShipping": "Digital · no shipping"
    },
    "buy": {
      "size": "Size",
      "sizeSoldOut": "{{size}}, sold out"
    }
  }
}
;
