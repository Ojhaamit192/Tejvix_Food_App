-- Run this in Supabase: Project → SQL Editor → New query → paste all → Run.

create extension if not exists "pgcrypto";

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  address text,
  phone text,
  whatsapp text,
  admin_pin text not null default '1234',
  upi_id text,
  payment_qr_url text,
  razorpay_key_id text,        -- set these two (+ optionally the webhook secret below) to switch this
  razorpay_key_secret text,    -- restaurant from the manual "UPI QR + UTR" flow to real, automatically
  razorpay_webhook_secret text,-- verified Razorpay Checkout payments — no staff confirmation step needed.
  brand_color text,
  photos text[],
  avg_prep_minutes int not null default 20,
  advance_deposit numeric not null default 100, -- charged to confirm a "reserve for later" table booking that has no food pre-ordered
  created_at timestamptz default now()
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  name text not null,
  category text not null,
  price numeric not null,
  veg boolean not null default true,
  is_bestseller boolean not null default false,
  is_available boolean not null default true,
  description text,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  day date not null default current_date,
  seq int not null,
  customer_name text not null,
  phone text not null,
  order_type text not null default 'dinein', -- dinein | takeaway
  table_number text,
  booking_type text not null default 'now', -- now | advance (a table reserved ahead of time)
  scheduled_at timestamptz, -- required when booking_type = 'advance'
  party_size int, -- number of guests, for advance table reservations
  payment_method text not null default 'upi', -- upi | counter (counter only used when a restaurant has no UPI set up)
  payment_status text not null default 'unverified', -- unverified | paid — "unverified" means the customer claims to have paid via UPI (with a UTR) but staff hasn't matched it against their own bank/UPI notification yet. "counter" payments are marked "paid" immediately since cash is collected in person.
  payment_utr text, -- the 12-digit UPI reference/UTR number the customer typed in, for staff to match
  payment_verify_deadline timestamptz, -- an "unverified" order auto-cancels if staff hasn't confirmed it by this time
  razorpay_payment_id text, -- set when payment_method = 'razorpay' — Razorpay's own automatically-verified payment ID
  razorpay_order_id text,   -- set when payment_method = 'razorpay' — Razorpay's own order ID for this payment
  status text not null default 'received', -- scheduled | received | preparing | ready | served | cancelled
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  notes text,
  created_at timestamptz default now(),
  queued_at timestamptz default now(), -- when the order actually entered the kitchen queue (= created_at for walk-ins, = check-in time for reservations)
  ready_at timestamptz,
  served_at timestamptz
);

create index if not exists idx_orders_restaurant_day on orders (restaurant_id, day);
create index if not exists idx_orders_restaurant_status on orders (restaurant_id, status);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id),
  name text not null,   -- snapshot, so a later menu edit never changes history
  price numeric not null,
  qty int not null
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);

-- Bridges Razorpay's flow: a Razorpay order is created (and the customer's
-- intended food order is stashed here) *before* the customer pays, since
-- Razorpay needs an order_id to open its checkout with. Once payment is
-- confirmed — by the browser calling back after Checkout succeeds, or by
-- Razorpay's webhook, whichever arrives first — the stashed payload becomes
-- a real row in `orders`, and this row is marked consumed. Having both
-- paths race safely (via the `consumed` flag) is what makes the webhook a
-- true backstop rather than a second place orders can be created.
create table if not exists pending_orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  razorpay_order_id text unique not null,
  amount numeric not null,
  payload jsonb not null,
  consumed boolean not null default false,
  order_id uuid references orders(id),
  created_at timestamptz default now()
);

-- Row Level Security: locked down. Only the server (using the Supabase
-- SERVICE ROLE key, in Netlify env vars) can read/write — that key bypasses
-- RLS entirely. No anon/public policies are added, so the database is not
-- reachable directly from the browser. All access goes through the
-- Netlify functions in netlify/functions/.
alter table restaurants enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table reviews enable row level security;
alter table pending_orders enable row level security;

-- ============================================================
-- Demo seed data — two Muzaffarpur restaurants, so the platform
-- can be shown working for more than one place from day one.
-- ============================================================
insert into restaurants (slug, name, address, phone, whatsapp, admin_pin, upi_id)
values
  ('tejvix-kitchen', 'Tejvix Kitchen', 'Kalambagh Chowk, Muzaffarpur, Bihar', '+91 90000 00001', '917367814387', '1234', 'tejvixkitchen@okicici'),
  ('bihar-swaad',    'Bihar Swaad',    'Club Road, Muzaffarpur, Bihar',       '+91 90000 00002', '917367814387', '5678', 'biharswaad@okhdfcbank')
on conflict (slug) do nothing;

-- Tejvix Kitchen — multi-cuisine (biryani / fast food / Chinese / North Indian),
-- the kind of menu a popular Muzaffarpur restaurant runs alongside local snacks.
insert into menu_items (restaurant_id, name, category, price, veg, is_bestseller, sort_order)
select id, v.name, v.category, v.price, v.veg, v.best, v.ord
from restaurants, (values
  ('Litti Chokha (4 pc)',        'Local Specials', 90,  true,  true,  1),
  ('Sattu Paratha (2 pc)',       'Local Specials', 70,  true,  false, 2),
  ('Chana Ghugni',               'Local Specials', 50,  true,  false, 3),
  ('Veg Biryani',                'Biryani',        160, true,  true,  10),
  ('Chicken Biryani',            'Biryani',        220, false, true,  11),
  ('Paneer Tikka',               'Starters',       190, true,  false, 20),
  ('Chicken Tikka',              'Starters',       230, false, false, 21),
  ('Veg Chowmein',               'Chinese',        110, true,  false, 30),
  ('Chicken Chowmein',           'Chinese',        150, false, false, 31),
  ('Veg Momos (8 pc)',           'Chinese',        90,  true,  true,  32),
  ('Chicken Momos (8 pc)',       'Chinese',        130, false, false, 33),
  ('Margherita Pizza',           'Fast Food',      199, true,  false, 40),
  ('Veg Burger',                 'Fast Food',      89,  true,  false, 41),
  ('Chicken Burger',             'Fast Food',      139, false, false, 42),
  ('Dal Makhani',                'Mains',          160, true,  false, 50),
  ('Butter Chicken',             'Mains',          260, false, true,  51),
  ('Butter Naan',                'Breads',         40,  true,  false, 60),
  ('Tandoori Roti',              'Breads',         18,  true,  false, 61),
  ('Gulab Jamun (2 pc)',         'Desserts',       50,  true,  false, 70),
  ('Thekua (4 pc)',              'Desserts',       40,  true,  false, 71),
  ('Masala Chaas',               'Beverages',      30,  true,  false, 80),
  ('Cold Coffee',                'Beverages',      70,  true,  false, 81)
) as v(name, category, price, veg, best, ord)
where restaurants.slug = 'tejvix-kitchen'
on conflict do nothing;

-- Bihar Swaad — a more local, thali/dhaba-style menu.
insert into menu_items (restaurant_id, name, category, price, veg, is_bestseller, sort_order)
select id, v.name, v.category, v.price, v.veg, v.best, v.ord
from restaurants, (values
  ('Litti Chokha (4 pc)',        'Local Specials', 80,  true,  true,  1),
  ('Litti with Mutton Curry',    'Local Specials', 180, false, true,  2),
  ('Dahi Chuda',                 'Local Specials', 60,  true,  false, 3),
  ('Veg Thali',                  'Thali',          110, true,  true,  10),
  ('Non-Veg Thali (Chicken)',    'Thali',          170, false, true,  11),
  ('Rohu Fish Curry',            'Mains',          220, false, false, 20),
  ('Mutton Curry',               'Mains',          280, false, false, 21),
  ('Rajma Chawal',               'Mains',          90,  true,  false, 22),
  ('Litti Chana (single)',       'Snacks',         25,  true,  false, 30),
  ('Aloo Chop (2 pc)',           'Snacks',         30,  true,  false, 31),
  ('Malpua (2 pc)',              'Desserts',       50,  true,  false, 40),
  ('Khaja (4 pc)',               'Desserts',       50,  true,  false, 41),
  ('Lassi',                      'Beverages',      40,  true,  false, 50),
  ('Nimbu Paani',                'Beverages',      20,  true,  false, 51)
) as v(name, category, price, veg, best, ord)
where restaurants.slug = 'bihar-swaad'
on conflict do nothing;
