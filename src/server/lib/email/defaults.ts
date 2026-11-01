/* Default email templates in the VAREL voice (sentence case, no exclamation marks), their variables and sample data.
   Port of VAREL worker/lib/email/defaults.ts (WP-22). Seeded by prisma/seed.sql (F1); also the fallback when a template row
   is missing and the admin's "Restore default". Variables are listed in docs/migration/handoff/WP-22.md. */
import type { TemplateVars } from './template'

export type EmailTemplateKey =
  | 'order_confirmation'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_refunded'
  | 'return_update'
  | 'password_reset'
  | 'welcome'
  | 'low_stock_alert'
  | 'abandoned_cart'
  | 'staff_invite'
  | 'account_deleted'

export interface TemplateVariable {
  name: string
  description: string
}

export interface TemplateDefault {
  key: EmailTemplateKey
  name: string
  description: string
  audience: 'customer' | 'staff'
  subject: string
  body: string
  variables: TemplateVariable[]
  sample: TemplateVars
  /** No longer sent here: the platform sends account emails (password reset) and staff are invited from the
      template's Users screen (PLAN.md D5, D9). Kept so seed rows and their translations stay valid; hidden from
      the admin and refused by sendTemplate. */
  retired?: true
}

/** Available in every template (filled in by sendTemplate when the caller does not pass them). */
export const COMMON_VARIABLES: TemplateVariable[] = [
  { name: 'storeName', description: 'Store name from settings, e.g. VAREL' },
  { name: 'supportEmail', description: 'Support address from settings' },
  { name: 'siteUrl', description: 'Public site origin, e.g. https://varel.studio' },
  { name: 'taxLabel', description: 'Tax name from settings, e.g. VAT (order templates can override it)' },
]

const ORDER_VARIABLES: TemplateVariable[] = [
  { name: 'firstName', description: 'Customer first name (account or shipping name); may be empty for guests' },
  { name: 'orderNumber', description: 'Order number, e.g. VRL-24817' },
  { name: 'orderUrl', description: 'Link to the order page (with the email for guests)' },
  { name: 'items', description: 'Rows: name, meta (colour · size), qty, total' },
  { name: 'subtotal', description: 'Formatted merchandise subtotal' },
  { name: 'discount', description: 'Formatted discount, e.g. −$25 (empty when none)' },
  { name: 'shipping', description: 'Formatted shipping, or "Free"' },
  { name: 'tax', description: 'Formatted tax (empty when zero)' },
  { name: 'taxLabel', description: 'Tax row label; defaults to the tax name in settings, e.g. VAT' },
  { name: 'total', description: 'Formatted order total' },
  { name: 'method', description: 'Shipping method, e.g. Express · 1–2 business days' },
  { name: 'paymentMethod', description: 'Card used, e.g. Visa ending 4242 (order confirmation)' },
  { name: 'shippingAddress', description: 'One-line shipping address (empty for digital orders)' },
]

const TRACKING_VARIABLES: TemplateVariable[] = [
  { name: 'carrier', description: 'Carrier name, e.g. DHL Express' },
  { name: 'trackingNumber', description: 'Tracking number' },
  { name: 'trackingUrl', description: 'Carrier tracking link' },
]

const SAMPLE_ITEMS = [
  { name: 'Atelier wool coat', meta: 'Stone · M', qty: 1, total: '$588' },
  { name: 'Fine merino rollneck', meta: 'Ecru · S', qty: 2, total: '$296' },
]

const SAMPLE_ORDER: TemplateVars = {
  firstName: 'Mira',
  orderNumber: 'VRL-24817',
  orderUrl: 'https://varel.studio/account/orders/VRL-24817/',
  items: SAMPLE_ITEMS,
  subtotal: '$884',
  discount: '−$88.40',
  shipping: 'Free',
  tax: '$198.90',
  taxLabel: 'VAT',
  total: '$994.50',
  method: 'Express · 1–2 business days',
  paymentMethod: 'Visa ending 4242',
  shippingAddress: 'Mira Holm, Jægersborggade 12, 2200 København N, Denmark',
}

const SAMPLE_COMMON: TemplateVars = { storeName: 'VAREL', supportEmail: 'care@varel.studio', siteUrl: 'https://varel.studio', taxLabel: 'VAT' }

const ORDER_LINES = `{{#items}}
{{name}} | {{meta}} | × {{qty}} | {{total}}
{{/items}}`

const ORDER_SUMMARY = `Subtotal | {{subtotal}}
Discount | {{discount}}
Shipping | {{shipping}}
{{taxLabel}} | {{tax}}
**Total** | **{{total}}**`

const SIGN_OFF = `With care,
The {{storeName}} studio`

export const TEMPLATE_DEFAULTS: TemplateDefault[] = [
  {
    key: 'order_confirmation',
    name: 'Order confirmation',
    description: 'Sent when an order is paid.',
    audience: 'customer',
    subject: 'Your order {{orderNumber}} is confirmed',
    body: `# Thank you for your order

Hello{{#firstName}} {{firstName}}{{/firstName}},

We have received order {{orderNumber}} and are preparing it in the studio. We will write again as soon as it is on its way.

${ORDER_LINES}

${ORDER_SUMMARY}

{{#shippingAddress}}
> Shipping to {{shippingAddress}}
> {{method}}
{{/shippingAddress}}

[View your order]({{orderUrl}})

Questions about your order? Reply to this email or write to {{supportEmail}}.

${SIGN_OFF}`,
    variables: ORDER_VARIABLES,
    sample: { ...SAMPLE_COMMON, ...SAMPLE_ORDER },
  },
  {
    key: 'order_shipped',
    name: 'Order shipped',
    description: 'Sent when an order is marked as shipped.',
    audience: 'customer',
    subject: 'Your order {{orderNumber}} is on its way',
    body: `# Your order is on its way

Hello{{#firstName}} {{firstName}}{{/firstName}},

Order {{orderNumber}} has left the studio{{#carrier}} with {{carrier}}{{/carrier}}.

{{#trackingNumber}}
Tracking number | {{trackingNumber}}
{{/trackingNumber}}

{{#trackingUrl}}
[Track your parcel]({{trackingUrl}})
{{/trackingUrl}}
{{^trackingUrl}}
[View your order]({{orderUrl}})
{{/trackingUrl}}

${ORDER_LINES}

{{#shippingAddress}}
> Shipping to {{shippingAddress}}
{{/shippingAddress}}

${SIGN_OFF}`,
    variables: [...ORDER_VARIABLES, ...TRACKING_VARIABLES],
    sample: { ...SAMPLE_COMMON, ...SAMPLE_ORDER, carrier: 'DHL Express', trackingNumber: '1Z 999 AA1 0123 4567', trackingUrl: 'https://www.dhl.com/track?id=1Z999AA10123456784' },
  },
  {
    key: 'order_delivered',
    name: 'Order delivered',
    description: 'Sent when an order is marked as delivered.',
    audience: 'customer',
    subject: 'Your order {{orderNumber}} has arrived',
    body: `# Your order has arrived

Hello{{#firstName}} {{firstName}}{{/firstName}},

Order {{orderNumber}} has been delivered. We hope each piece is everything you expected, and that you wear it for years.

If something is not right, you have {{returnWindowDays}} days to return it.

[View your order]({{orderUrl}})

> Care notes for every piece are on its product page. Wool and cashmere rest best folded, never hung.

${SIGN_OFF}`,
    variables: [...ORDER_VARIABLES, { name: 'returnWindowDays', description: 'Return window in days, from settings' }, { name: 'returnsUrl', description: 'Link to the returns page' }],
    sample: { ...SAMPLE_COMMON, ...SAMPLE_ORDER, returnWindowDays: 30, returnsUrl: 'https://varel.studio/returns/' },
  },
  {
    key: 'order_refunded',
    name: 'Order refunded',
    description: 'Sent when an order is refunded in full.',
    audience: 'customer',
    subject: 'Your refund for order {{orderNumber}}',
    body: `# Your refund is on its way

Hello{{#firstName}} {{firstName}}{{/firstName}},

We have refunded {{refundAmount}} for order {{orderNumber}} to your original payment method. It can take five to ten working days to appear on your statement.

[View your order]({{orderUrl}})

${SIGN_OFF}`,
    variables: [...ORDER_VARIABLES, { name: 'refundAmount', description: 'Formatted amount refunded' }],
    sample: { ...SAMPLE_COMMON, ...SAMPLE_ORDER, refundAmount: '$994.50' },
  },
  {
    key: 'return_update',
    name: 'Return update',
    description: 'Sent when a return changes status (approved, received, refunded or declined).',
    audience: 'customer',
    subject: 'Your return for order {{orderNumber}} is {{returnStatus}}',
    body: `# Your return is {{returnStatus}}

Hello{{#firstName}} {{firstName}}{{/firstName}},

{{#approved}}
We have approved your return for order {{orderNumber}}. Pack the pieces in their original packaging and send them to the studio within 14 days. Once they arrive we will check them and refund you.
{{/approved}}
{{#received}}
Your return for order {{orderNumber}} has arrived at the studio. We are checking the pieces now and will refund you within three business days.
{{/received}}
{{#refunded}}
We have refunded {{refundAmount}} for your return on order {{orderNumber}}. It can take five to ten working days to appear on your statement.
{{/refunded}}
{{#rejected}}
We are unable to accept the return for order {{orderNumber}}. If you would like to know more, reply to this email and we will explain.
{{/rejected}}
{{#requested}}
We have reopened your return request for order {{orderNumber}} and will review it again shortly.
{{/requested}}

{{#items}}
{{name}} | {{meta}} | × {{qty}}
{{/items}}

{{#note}}
> {{note}}
{{/note}}

[View your order]({{orderUrl}})

${SIGN_OFF}`,
    variables: [
      { name: 'firstName', description: 'Customer first name' },
      { name: 'orderNumber', description: 'Order number' },
      { name: 'orderUrl', description: 'Link to the order page' },
      { name: 'returnStatus', description: 'New status in lower case: approved, received, refunded, declined, requested' },
      { name: 'approved', description: 'True when the return was approved (use as a section)' },
      { name: 'received', description: 'True when the return arrived at the studio' },
      { name: 'refunded', description: 'True when the return was refunded' },
      { name: 'rejected', description: 'True when the return was declined' },
      { name: 'requested', description: 'True when a declined return was reopened' },
      { name: 'refundAmount', description: 'Formatted refund for this return (refunded only)' },
      { name: 'items', description: 'Rows of the returned lines: name, meta, qty' },
      { name: 'note', description: 'Note from the studio, if one was added' },
    ],
    sample: {
      ...SAMPLE_COMMON,
      firstName: 'Mira',
      orderNumber: 'VRL-24817',
      orderUrl: 'https://varel.studio/account/orders/VRL-24817/',
      returnStatus: 'approved',
      approved: true,
      items: [{ name: 'Fine merino rollneck', meta: 'Ecru · S', qty: 1, total: '$148' }],
      note: 'Use the prepaid label in your parcel.',
    },
  },
  {
    key: 'password_reset',
    retired: true,
    name: 'Password reset',
    description: 'Sent when someone asks to reset their password.',
    audience: 'customer',
    subject: 'Reset your {{storeName}} password',
    body: `# Reset your password

Hello{{#firstName}} {{firstName}}{{/firstName}},

We received a request to reset the password for your {{storeName}} account. The link below works for one hour.

[Choose a new password]({{resetUrl}})

> If you did not ask for this, you can ignore this email. Your password stays as it is.`,
    variables: [
      { name: 'firstName', description: 'Account first name' },
      { name: 'resetUrl', description: 'One-time reset link, valid for one hour' },
    ],
    sample: { ...SAMPLE_COMMON, firstName: 'Mira', resetUrl: 'https://varel.studio/account/reset/?token=sample' },
  },
  {
    key: 'welcome',
    name: 'Welcome',
    description: 'Sent when a customer creates an account.',
    audience: 'customer',
    subject: 'Welcome to {{storeName}}',
    body: `# Welcome, {{firstName}}

Your account is ready. Track your orders, keep a wishlist of the pieces you are considering and check out a little faster.

Everything we make is cut in small runs from natural fibres, to be worn and repaired for years.

[Explore the collection]({{siteUrl}})

${SIGN_OFF}`,
    variables: [
      { name: 'firstName', description: 'Account first name' },
      { name: 'accountUrl', description: 'Link to the account page' },
    ],
    sample: { ...SAMPLE_COMMON, firstName: 'Mira', accountUrl: 'https://varel.studio/account/' },
  },
  {
    key: 'low_stock_alert',
    name: 'Low stock alert',
    description: 'Sent to the staff alert address when an order takes a variant to or below the low-stock threshold.',
    audience: 'staff',
    subject: 'Low stock after order {{orderNumber}}',
    body: `# Stock is running low

Order {{orderNumber}} took these variants to or below the low-stock threshold of {{threshold}}.

{{#items}}
{{name}} | {{meta}} | {{sku}} | {{stock}} left
{{/items}}

[Open inventory]({{inventoryUrl}})`,
    variables: [
      { name: 'orderNumber', description: 'The order that triggered the alert' },
      { name: 'threshold', description: 'Low-stock threshold from settings' },
      { name: 'items', description: 'Rows: name, meta (colour · size), sku, stock' },
      { name: 'inventoryUrl', description: 'Link to the admin inventory' },
    ],
    sample: {
      ...SAMPLE_COMMON,
      orderNumber: 'VRL-24914',
      threshold: 6,
      items: [{ name: 'Atelier wool coat', meta: 'Stone · M', sku: 'VRL-AWC-STO-M', stock: 2 }],
      inventoryUrl: 'https://varel.studio/dashboard/inventory',
    },
  },
  {
    key: 'abandoned_cart',
    name: 'Abandoned bag',
    description: 'Sent once when a bag with an email is left without checking out.',
    audience: 'customer',
    subject: 'Your bag is waiting',
    body: `# Your bag is waiting

Hello{{#firstName}} {{firstName}}{{/firstName}},

You left a few pieces in your bag. We have saved it for you, though we make in small runs and cannot hold stock for long.

${ORDER_LINES}

[Return to your bag]({{cartUrl}})

> You are receiving this because you entered your email at checkout. We send one reminder only.`,
    variables: [
      { name: 'firstName', description: 'First name, when known' },
      { name: 'items', description: 'Rows: name, meta, qty, total' },
      { name: 'subtotal', description: 'Formatted bag subtotal' },
      { name: 'cartUrl', description: 'Signed recovery link that restores the bag' },
    ],
    sample: { ...SAMPLE_COMMON, firstName: 'Mira', items: SAMPLE_ITEMS, subtotal: '$884', cartUrl: 'https://varel.studio/site-api/cart/recover/sample' },
  },
  {
    key: 'staff_invite',
    retired: true,
    name: 'Staff invitation',
    description: 'Sent when an admin invites someone to the studio admin.',
    audience: 'staff',
    subject: 'You are invited to the {{storeName}} studio',
    body: `# Join the studio

{{#inviterName}}{{inviterName}} has invited you{{/inviterName}}{{^inviterName}}You have been invited{{/inviterName}} to help run {{storeName}}.

Role | {{role}}
Access | {{areas}}

[Accept the invitation]({{inviteUrl}})

> The invitation expires in seven days. If you were not expecting it, you can ignore this email.`,
    variables: [
      { name: 'inviteUrl', description: 'Link to accept the invitation' },
      { name: 'inviterName', description: 'Name of the admin who sent it' },
      { name: 'role', description: 'Role offered: Staff or Admin' },
      { name: 'areas', description: 'Areas they can use, e.g. Orders, Products or Every area' },
    ],
    sample: { ...SAMPLE_COMMON, inviteUrl: 'https://varel.studio/accept-invite?token=sample', inviterName: 'Astrid Varel', role: 'Staff', areas: 'Orders, Products' },
  },
  {
    key: 'account_deleted',
    name: 'Account deleted',
    description: 'Sent to the original address when a customer account is deleted.',
    audience: 'customer',
    subject: 'Your {{storeName}} account has been deleted',
    body: `# Your account has been deleted

Hello{{#firstName}} {{firstName}}{{/firstName}},

As you asked, we have deleted your {{storeName}} account and the personal details attached to it. Past orders are kept for our accounting records, with your details removed.

You are welcome back whenever you like.

> If you did not ask for this, write to {{supportEmail}} straight away.`,
    variables: [{ name: 'firstName', description: 'First name before deletion' }],
    sample: { ...SAMPLE_COMMON, firstName: 'Mira' },
  },
]

export const TEMPLATE_KEYS = TEMPLATE_DEFAULTS.map((t) => t.key) as EmailTemplateKey[]

export const templateDefault = (key: string): TemplateDefault | undefined => TEMPLATE_DEFAULTS.find((t) => t.key === key)

/** Templates this store still sends, in VAREL's order (the admin lists these). */
export const ACTIVE_TEMPLATES: TemplateDefault[] = TEMPLATE_DEFAULTS.filter((t) => !t.retired)

export const ACTIVE_TEMPLATE_KEYS: EmailTemplateKey[] = ACTIVE_TEMPLATES.map((t) => t.key)

/** Active templates sent to customers: the `email_template` translation source (WP-25, Settings · Languages). */
export const CUSTOMER_TEMPLATE_KEYS: EmailTemplateKey[] = ACTIVE_TEMPLATES.filter((t) => t.audience === 'customer').map((t) => t.key)

/** An active template's defaults (`undefined` for unknown and retired keys). */
export const activeTemplate = (key: string): TemplateDefault | undefined => ACTIVE_TEMPLATES.find((t) => t.key === key)
