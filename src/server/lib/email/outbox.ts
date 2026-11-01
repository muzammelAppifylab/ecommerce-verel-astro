/* Outbox: nothing leaves the Worker. The EmailMessage row (status "stored") is the email, readable in Admin → Emails.
   The default provider, for local development, demos and stores that have not chosen a provider yet. */
import type { ProviderSend } from './provider'

export const sendOutbox: ProviderSend = async () => ({ id: null })
