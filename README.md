# Tejvix Food — Multi-Restaurant Dine-in & Takeaway Platform

A real ordering + kitchen platform for local restaurants — not just a menu
demo. Built the same way as the Tejvix Salon queue app: **Supabase**
(database) + serverless functions, deployed entirely on **Netlify**
(frontend + backend). Payment is always collected upfront via UPI before
an order reaches the kitchen or a table reservation is confirmed — no
delivery, this is built for **dine-in and takeaway**, with dine-in also
supporting **reserving a table up to a week ahead** for lunch or dinner
with family or friends.

Two demo restaurants are seeded so you can show it working for more than
one place: **Tejvix Kitchen** (multi-cuisine) and **Bihar Swaad** (a
local thali/dhaba-style menu with litti-chokha, sattu paratha, thekua,
mutton curry, etc.), both in Muzaffarpur.

## Why this is a step up from a static menu page

The old `Food_App/index.html` looked good but had no real backend — orders
only existed as a WhatsApp message and a browser `localStorage` setting.
That's fine for a single till, but it means:
- The kitchen has no live order queue — someone has to keep checking WhatsApp.
- There's no way to mark a dish "sold out" without editing code.
- There's no record of orders, revenue, or what's actually selling.
- It can't support more than one restaurant.

This version fixes all four while keeping the same clean customer-facing
look and the dine-in/takeaway toggle you already had.

## What's in this project

- `index.html` — the customer-facing app. With no `?restaurant=` in the URL
  it shows a **directory** of restaurants; with `?restaurant=tejvix-kitchen`
  it shows that restaurant's menu, cart, and order tracking. A table's QR
  code can also encode `?restaurant=tejvix-kitchen&table=6` so dine-in
  orders arrive with the table already filled in.

  **Payment is always collected before an order reaches the kitchen — and
  when a restaurant has Razorpay set up, it's verified automatically, no
  staff step required.** The customer fills in their order, taps "Proceed
  to pay", and:

  - **If the restaurant has Razorpay configured** (see "Setting up
    Razorpay" below): Razorpay's own Checkout opens (UPI, cards, wallets —
    whatever the customer prefers), and the moment payment succeeds, the
    order is created and marked paid automatically. Nobody at the
    restaurant has to lift a finger to confirm it.
  - **If not**, it falls back to a manual flow: the restaurant's UPI QR
    (pre-filled with the exact amount) is shown, the customer pays in their
    own UPI app, types in the **UTR / reference number** their app shows
    for that payment, and taps "I've completed the payment". The order is
    created immediately and shows up on the kitchen board tagged
    **"⚠ Payment unverified"** with that UTR visible — a restaurant's own
    UPI app already makes a sound the instant money lands, so staff match
    the amount and UTR against that notification and tap
    **"✅ Confirm payment"** before the order can move into "Preparing"
    (the server enforces this, not just the UI). If nobody confirms within
    10 minutes, the order auto-cancels on its own.
  - **If the restaurant has no UPI set up either**, this falls back once
    more to a plain "pay at counter" confirmation — no UTR needed, since
    cash changes hands in person.

  After paying, the customer can tap **"Send order to WhatsApp"** to send a
  one-click payment receipt straight to the restaurant's phone regardless
  of which path was used — useful as a backup so staff never miss an order.

  Dine-in also supports **"Reserve a table for later"** — booking up to 7
  days ahead, choosing a date, Lunch or Dinner, a specific time slot within
  that period, and the number of guests ("family & friends"). Food can be
  pre-ordered along with the reservation, or left for later — either way,
  payment (the food total, or a flat advance deposit if no food is chosen
  yet) is collected upfront to confirm the booking, exactly like a normal
  order. The reservation shows a "Reservation confirmed" ticket instead of
  a live kitchen tracker, and automatically switches over to live order
  tracking the moment staff check the guest in.

- `admin.html` — the **kitchen/staff panel**, opened as
  `admin.html?restaurant=tejvix-kitchen`, PIN-protected. Four tabs:
  **Live Orders** (a 3-column kitchen board: New → Preparing → Ready. An
  order paid via UPI shows a "⚠ Payment unverified" badge with its UTR and
  a countdown until it auto-cancels, plus a **"✅ Confirm payment"** button
  in place of "Start preparing" until staff tap it — with one-tap
  "Start preparing" / "Mark ready" / "Mark served" after that, and a beep
  when a new order lands), **Reservations** (every upcoming advance table
  booking with date/time, guest count, any pre-order, and the same
  unverified/confirm-payment flow — with a "Guest arrived — check in"
  button, available once payment is confirmed, that assigns a table and a
  real kitchen token), **Menu** (toggle any dish "sold out" the moment the
  kitchen runs out — it disappears from ordering immediately), and
  **Today** (orders, revenue, dine-in vs takeaway split, most popular dish,
  busiest hour, upcoming reservations, and how many payments are currently
  unverified).

- `netlify/functions/` — serverless functions: `restaurants.js` (directory),
  `menu.js` (menu for one restaurant), `_create_order.js` (shared helper —
  not an endpoint — that actually inserts a fully-priced, already-paid
  order; used by all three payment paths below so they stay consistent),
  `create_payment_order.js` + `confirm_razorpay_payment.js` +
  `razorpay_webhook.js` (the Razorpay path — creates a Razorpay order,
  verifies its Checkout signature, and a webhook backstop in case the
  browser tab closes before the callback runs), `order.js` (the manual
  UPI-QR-plus-UTR / pay-at-counter path, used only when a restaurant hasn't
  set up Razorpay), `verify_payment.js` (staff confirm a manual UTR
  payment), `orders.js` (kitchen's live order feed — also auto-cancels any
  manual-flow order whose payment verification window has lapsed),
  `status.js` (advance an order's status; refuses to start "preparing" on
  an unverified manual payment), `checkin.js` (staff check in a reserved
  guest — refuses if payment is still unverified), `reservations.js` (list
  upcoming reservations), `menu_toggle.js` (mark a dish available/sold
  out), `track.js` (the customer's live status poll — no PIN needed; also
  sweeps its own expiry), `reviews.js`, `analytics.js`.
- `supabase/schema.sql` — the database schema, run once in your Supabase
  project. Seeds the two demo restaurants and their menus.
- `netlify.toml` — routes `/api/*` to the functions.

## How the pieces fit together

```
Customer's phone  ──►  index.html (?restaurant=tejvix-kitchen&table=6)
                          │  fetch("/api/menu"), fetch("/api/order"), fetch("/api/track")
                          ▼
                    Netlify Functions  ──►  Supabase (Postgres)
                                              stores restaurants, menu, orders

Kitchen counter   ──►  admin.html (?restaurant=tejvix-kitchen)  [PIN-protected]
                          │  fetch("/api/orders") every 5s, fetch("/api/status")
                          ▼
                    Netlify Functions  ──►  Supabase: order status, menu availability
```

The database is never reached directly from the browser — Supabase's
**service role key** (a secret, full-access key) lives only in Netlify's
environment variables and is used only inside the functions. This is why
`supabase/schema.sql` adds no public read/write policies: the only door in
is through your own functions.

## 1. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the entire contents of
   `supabase/schema.sql`, and run it. This creates the tables and seeds
   Tejvix Kitchen and Bihar Swaad with their menus.
3. Go to **Settings → API** and copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (not the `anon` key!) → this is `SUPABASE_SERVICE_ROLE_KEY`

## 2. Push to GitHub & deploy on Netlify

```bash
git init
git add .
git commit -m "Tejvix Food — dine-in & takeaway platform"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Then on [app.netlify.com](https://app.netlify.com): **Add new site → Import
an existing project** → connect the repo. `netlify.toml` already sets the
build config, so just deploy.

## 3. Add environment variables

In Netlify: **Site settings → Environment variables**, add:

| Key | Value |
|---|---|
| `SUPABASE_URL` | from Supabase Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key (keep secret!) |

Redeploy (**Deploys → Trigger deploy**) so the functions pick these up.
Without these set, the API calls will fail with a 500 — the demo pages
still load, but ordering won't work until Supabase is connected.

## Try it out

- Directory: `https://your-site.netlify.app/`
- Tejvix Kitchen's page: `https://your-site.netlify.app/index.html?restaurant=tejvix-kitchen`
- Bihar Swaad's page: `https://your-site.netlify.app/index.html?restaurant=bihar-swaad`
- A table's QR code: `.../index.html?restaurant=tejvix-kitchen&table=6`
- Reserve a table: open a restaurant's page and tap **"Reserve a table for later"** near the top of the menu
- Tejvix Kitchen's kitchen panel: `.../admin.html?restaurant=tejvix-kitchen` (PIN: `1234`)
- Bihar Swaad's kitchen panel: `.../admin.html?restaurant=bihar-swaad` (PIN: `5678`)

(Change these demo PINs in the `restaurants` table before showing this to
anyone outside your team.)

## Setting up Razorpay (recommended — automatic payment verification)

Razorpay works for a sole proprietorship with just an **Udyam (MSME)
certificate** — GST or a private limited company is not required for
their KYC. Required docs, per Razorpay's own onboarding: the proprietor's
PAN, one photo ID (Aadhaar/Voter ID/Passport), one business proof (Udyam
certificate qualifies), and a bank account in a matching name. Fees are
~2% per transaction, no setup or annual charge. (Confirm current
requirements on Razorpay's own signup flow — policies can change.)

Once you have a Razorpay account for a restaurant:

1. Razorpay Dashboard → **Settings → API Keys** → generate a Key ID and
   Key Secret.
2. In Supabase → Table Editor → `restaurants`, open that restaurant's row
   and set:
   - **`razorpay_key_id`** — the Key ID (safe to expose to the browser —
     the frontend needs it to open Checkout)
   - **`razorpay_key_secret`** — the Key Secret (never exposed — used only
     server-side, in `create_payment_order.js` and
     `confirm_razorpay_payment.js`, to talk to Razorpay's API and verify
     payment signatures)
3. *(Optional but recommended)* Razorpay Dashboard → **Settings → Webhooks**
   → add a webhook pointing at `https://your-site.netlify.app/api/razorpay_webhook`,
   subscribed to the **`payment.captured`** event, and set a secret. Paste
   that same secret into the restaurant's **`razorpay_webhook_secret`**
   column in Supabase. This is a backstop only — the app already creates
   and confirms the order the instant Checkout succeeds — but it protects
   against the rare case where a customer's browser tab closes right after
   paying, before that confirmation call completes; without a webhook
   secret set, the webhook endpoint just ignores every event and does
   nothing (see "Limitations" for why it's not trusted until then).

That's it — the moment `razorpay_key_id` and `razorpay_key_secret` are
both set, that restaurant's customers see Razorpay Checkout instead of the
manual UPI QR, for every order and every table reservation. A restaurant
with neither set still works exactly as before (manual UPI QR + UTR, or
pay at counter) — Razorpay is additive, not required.

## Setting up the manual UPI/counter fallback, branding and WhatsApp

These only matter for a restaurant that hasn't set up Razorpay above —
once `razorpay_key_id` + `razorpay_key_secret` are set, `upi_id` and
`payment_qr_url` are simply unused. Open Supabase → Table Editor →
`restaurants`, find the restaurant's row, and fill in:

- **`upi_id`** — the restaurant's UPI ID (e.g. `restaurant@okhdfcbank`). This
  is required for the pay-first flow — a QR appears before every order and
  every table reservation, pre-filled with the exact amount, and works with
  any UPI app. A restaurant with no `upi_id` and no `payment_qr_url` falls
  back to a "pay at counter" confirmation instead.
- **`payment_qr_url`** — instead of a dynamic UPI QR, paste a link to a
  photo of the restaurant's own printed QR code. If both this and `upi_id`
  are set, `payment_qr_url` takes priority.
- **`advance_deposit`** — the amount (default ₹100) charged to confirm a
  table reservation when the guest hasn't pre-ordered any food yet.
- **`whatsapp`** — country code + number, no `+` or spaces (e.g.
  `91XXXXXXXXXX`). After paying, the customer can tap "Send order to
  WhatsApp" to also send a one-click payment receipt straight to the
  restaurant's phone — useful as a backup so staff never miss an order
  even before checking the kitchen panel.
- **`brand_color`** — a hex color (e.g. `#2E86DE`) to give a restaurant its
  own accent color instead of the default Tejvix green.
- **`avg_prep_minutes`** — how long a typical order takes, shown to the
  customer while they wait.

Only `upi_id` (or `payment_qr_url`) actually needs to be set for the app to
work as intended — without it, every order falls back to pay-at-counter.

## Adding a new restaurant

Run this in Supabase's SQL Editor (adjust the values), then add its menu
items the same way the seed data in `schema.sql` does:

```sql
insert into restaurants (slug, name, address, phone, admin_pin, upi_id)
values ('new-restaurant-slug', 'New Restaurant Name', 'Address, Muzaffarpur', '+91 xxxxxxxxxx', '9999', 'restaurant@upi');
```

(Add `razorpay_key_id` and `razorpay_key_secret` too if this restaurant
already has a Razorpay account — see "Setting up Razorpay" above.)

It'll immediately show up in the directory and get its own ordering page
and kitchen panel — no code changes needed.

## Reservation time slots

Lunch and dinner slots are defined as constants near the top of the
`<script>` in `index.html` (`LUNCH_SLOTS` and `DINNER_SLOTS`), currently
12:00–3:00 PM and 7:00–10:30 PM in 30-minute steps. Edit that list to match
a restaurant's actual hours; how far ahead guests can book is set by
`MAX_ADVANCE_DAYS` (7) in both `index.html` and `netlify/functions/order.js`
— keep the two in sync if you change it.

## Why it's built this way for the Muzaffarpur market

- **Payment upfront, verified — not just trusted.** Every order and every
  table reservation is paid before it reaches the kitchen. Once a
  restaurant's Razorpay is set up (all it needs is an Udyam/MSME
  certificate — no GST or company registration required), payment is
  verified automatically the instant Checkout succeeds. Until then, a free
  manual fallback still holds the same line: the customer supplies their
  UPI UTR, and staff confirm it against their own bank/UPI notification
  before the kitchen starts cooking. Either way this avoids no-shows on
  reserved tables and walked-off orders. A restaurant with neither Razorpay
  nor UPI set up falls back to pay at counter automatically rather than
  blocking the order.
- **A one-tap WhatsApp receipt to the restaurant.** The moment payment is
  done, the customer can send a formatted receipt straight to the
  restaurant's WhatsApp — a familiar, zero-training backup channel on top
  of the kitchen panel.
- **Book a table up to a week ahead, for families and friend groups.**
  Picking a date, Lunch or Dinner, an exact time slot, and a guest count
  covers how people actually plan a group dinner out, without needing to
  call and hope someone picks up.
- **No delivery, on purpose.** Dine-in and takeaway match how most
  Muzaffarpur restaurants actually run — adding delivery logistics would
  add cost and complexity without matching the ask.
- **"Sold out" toggle for the kitchen.** Small kitchens run out of a dish
  mid-shift far more often than large chains; staff need to pull an item
  from ordering in one tap, not through a code change.
- **A kitchen board, not just a WhatsApp message.** Staff can see every
  live order queued by status without picking up a phone, and a customer's
  order token doubles as their dine-in table marker or takeaway pickup
  proof.
- **Hinglish-friendly, low-jargon UI** — plain "Dine-in / Takeaway",
  "Reserve for later" rather than delivery-app jargon that assumes a
  big-city audience.
- **Works on a basic Android phone and a slow connection** — a single
  static page per screen, small payloads, and a service worker so the app
  shell loads instantly on a repeat visit even on patchy network.

## Limitations to know about (this is a strong demo, not a POS replacement)

- The kitchen panel's PIN check is simple, meant for a single-counter demo,
  not bank-grade security — good enough to show the concept; add real staff
  logins before running this for real money at scale.
- The live order board and customer tracking screen poll every 5 seconds
  rather than updating instantly. Supabase's Realtime feature could push
  updates the moment they happen — a good next upgrade once the basics are
  working, same as noted in the salon app.
- **Razorpay is now integrated and is the recommended path** — when a
  restaurant sets `razorpay_key_id` + `razorpay_key_secret`, payment is
  verified automatically via a signed callback from Razorpay's own
  Checkout, with a webhook (once `razorpay_webhook_secret` is set too) as
  a backstop if the browser closes before that callback runs. This is a
  real, cryptographically-verified confirmation — not a human glancing at
  a notification. The **manual UTR flow only runs for a restaurant that
  hasn't set up Razorpay yet**, as a free fallback: the customer supplies
  a UTR and staff match it against their own bank/UPI notification before
  cooking starts, and unconfirmed claims silently expire in 10 minutes.
  It's a solid stopgap, but (unlike Razorpay) a determined bad actor could
  still copy a stale or unrelated UTR and hope staff don't check carefully
  — which is exactly why moving every restaurant onto Razorpay as soon as
  its KYC is done is worth doing.
- The Razorpay webhook is a genuine backstop, but only once a
  `razorpay_webhook_secret` is configured for that restaurant (see
  "Setting up Razorpay" above) — without one, the webhook endpoint
  intentionally ignores every event rather than trusting an unsigned
  request, so the browser-side confirmation call remains the only path
  for that restaurant until a webhook secret is added.
- Reservation time slots are a fixed list edited in code (see above), not
  a per-restaurant table-capacity system — there's no limit on how many
  parties can book the same slot. Fine for a single-counter demo; a real
  deployment with heavy reservation volume would want actual table/seat
  capacity tracking.
- Reviews and loyalty tracking are simple, on-page features (no SMS
  reminders) — a good first version, not a full CRM.
- Analytics are simple aggregates computed on the fly — fine at this
  scale, but a growing multi-branch chain would eventually want a proper
  reporting table.
