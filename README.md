# WedPlan — Server (Express.js)

REST API for **WedPlan**, a wedding planning platform. Express + MongoDB, authentication with **Better Auth** (JWT plugin), payments with **Stripe Checkout + webhooks**, images via **ImgBB**.

- **Live API:** `https://YOUR-SERVER.vercel.app`
- **Live website:** `https://YOUR-CLIENT.vercel.app`
- **Client repository:** `https://github.com/YOUR-USER/wedplan-client`
- **Server repository:** `https://github.com/YOUR-USER/wedplan-server`

## Important features
- Better Auth (email/password + Google) mounted at `/api/auth/*`; admin accounts can never be created publicly
- **JWT verification middleware** (`jose`, Better Auth JWKS) → returns **401** for missing/invalid/expired tokens; role middleware returns **403**
- The user's role and blocked state are always re-read from MongoDB, never trusted from the client
- Services: public listing (approved + active only), search, category/location filters, price sorting, pagination
- Bookings: duplicate prevention (same service + date), no self-booking, no admin booking, atomic accept/reject/cancel with ownership checks
- Free plan limit: 3 active services; Premium unlimited; expiry/cancellation downgrades the vendor
- Stripe: Checkout Session created server-side for the authenticated vendor; **Premium is activated only from verified webhook events** (`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`); idempotent transaction records
- Admin: stats, users (block/unblock + forced logout), services moderation, read-only transactions (no write endpoint exists)
- zod validation, central error handler, helmet, rate-limited image upload

## Technology stack
Node.js · Express 4 · MongoDB (native driver) · Better Auth · jose · Stripe · zod · multer · ImgBB

## Collections
`users` (Better Auth, extended with `role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt`) · `services` · `bookings` · `transactions` (+ Better Auth's `session`, `account`, `verification`, `jwks`)

## Installation & running locally
```bash
git clone https://github.com/YOUR-USER/wedplan-server.git
cd wedplan-server
npm install
cp .env.example .env       # fill in the values
npm run seed               # creates the admin (+ demo vendor/customer and sample services)
npm run dev                # http://localhost:5000
```
Stripe webhooks locally:
```bash
stripe listen --forward-to localhost:5000/api/webhooks/stripe   # copy the whsec_... into STRIPE_WEBHOOK_SECRET
```

## Environment variables
| Variable | Description |
| --- | --- |
| `PORT` | Server port (default 5000) |
| `CLIENT_URL` | Deployed client URL (CORS, trusted origin, Stripe redirects) |
| `MONGODB_URI`, `DB_NAME` | MongoDB connection string and database name |
| `BETTER_AUTH_SECRET` | Long random secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | The **client** origin (the client proxies `/api/*` to this server) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe test-mode secret key and webhook signing secret |
| `PREMIUM_PRICE_USD` | Monthly Premium price (default 19) |
| `IMGBB_API_KEY` | ImgBB API key |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Used only by `npm run seed` |

Never commit `.env` (it is git-ignored).

## Required application URLs
- Google OAuth redirect URI: `{CLIENT_URL}/api/auth/callback/google`
- Stripe webhook endpoint: `{SERVER_URL}/api/webhooks/stripe` (events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`)

## API overview
| Area | Endpoints |
| --- | --- |
| Public | `GET /api/services`, `/api/services/featured`, `/api/categories`, `POST /api/upload` |
| Any signed-in user | `GET /api/me`, `PATCH /api/profile`, `GET /api/services/:id` |
| Customer | `POST /api/bookings`, `GET /api/bookings/mine`, `/stats`, `PATCH /api/bookings/:id/cancel` |
| Vendor | `/api/vendor/stats`, `/services` (CRUD, availability), `/bookings`, `/subscription`, `/api/payments/*` |
| Admin | `/api/admin/stats`, `/users`, `/services`, `/transactions` |

## Deployment (Vercel)
`vercel.json` is included. Add all environment variables in the project settings.
