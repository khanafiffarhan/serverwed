// Black-box checks against a RUNNING server. Usage:
//   API_URL=http://localhost:5000 CLIENT_URL=http://localhost:3000 npm run smoke
// Requires `npm run seed` first (uses the seeded admin / vendor / customer accounts).
const API = (process.env.API_URL || "http://localhost:5000").replace(/\/$/, "");
const ORIGIN = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");
const ACC = {
  admin: [process.env.ADMIN_EMAIL || "admin@wedplan.com", process.env.ADMIN_PASSWORD || "ChangeMe123"],
  vendor: ["vendor@wedplan.demo", "Vendor123"],
  customer: ["customer@wedplan.demo", "Customer123"],
};
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`); };

async function call(method, path, { token, body } = {}) {
  const r = await fetch(API + path, { method, headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function login([email, password]) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const t = await fetch(`${API}/api/auth/token`, { headers: { Cookie: cookie, Origin: ORIGIN } });
  return (await t.json().catch(() => ({}))).token;
}

const tok = {};
for (const k of Object.keys(ACC)) { tok[k] = await login(ACC[k]); check(`login + JWT obtained (${k})`, !!tok[k]); }
if (!tok.admin || !tok.vendor || !tok.customer) { console.log("\nCannot continue without all three tokens. Did you run `npm run seed`?"); process.exit(1); }

// --- JWT verification ---
check("no token -> 401", (await call("GET", "/api/me")).status === 401);
check("garbage token -> 401", (await call("GET", "/api/me", { token: "abc.def.ghi" })).status === 401);
const tampered = tok.customer.slice(0, -4) + "AAAA";
check("tampered token -> 401", (await call("GET", "/api/me", { token: tampered })).status === 401);
check("valid token -> 200", (await call("GET", "/api/me", { token: tok.customer })).status === 200);

// --- Role permissions (403) ---
check("customer cannot open admin API", (await call("GET", "/api/admin/stats", { token: tok.customer })).status === 403);
check("vendor cannot open admin API", (await call("GET", "/api/admin/users", { token: tok.vendor })).status === 403);
check("customer cannot open vendor API", (await call("GET", "/api/vendor/stats", { token: tok.customer })).status === 403);
check("vendor cannot open customer bookings", (await call("GET", "/api/bookings/mine", { token: tok.vendor })).status === 403);
check("admin can open admin API", (await call("GET", "/api/admin/stats", { token: tok.admin })).status === 200);
check("vendor cannot create checkout as customer role", (await call("POST", "/api/payments/checkout", { token: tok.customer })).status === 403);

// --- Sorting ---
const asc = (await call("GET", "/api/services?sort=price_asc&limit=24")).data.items || [];
const desc = (await call("GET", "/api/services?sort=price_desc&limit=24")).data.items || [];
check("services exist for sorting", asc.length > 1);
check("price ascending", asc.every((s, i) => i === 0 || asc[i - 1].price <= s.price));
check("price descending", desc.every((s, i) => i === 0 || desc[i - 1].price >= s.price));
check("search filter works", (await call("GET", "/api/services?search=zzzz-no-match")).data.total === 0);
check("only approved+active are public", asc.every((s) => s.status === "approved" && s.isActive));

// --- Signup protections ---
const weak = await call("POST", "/api/auth/sign-up/email", { body: { name: "X Y", email: `w${Date.now()}@t.dev`, password: "alllower1" } });
check("weak password rejected", weak.status >= 400 && weak.status < 500);
const adm = await call("POST", "/api/auth/sign-up/email", { body: { name: "Evil Admin", email: `e${Date.now()}@t.dev`, password: "Abcdef1", role: "admin" } });
check("public signup as admin rejected", adm.status >= 400 && adm.status < 500);

// --- Profile cannot change role / plan ---
check("profile update with role rejected", (await call("PATCH", "/api/profile", { token: tok.customer, body: { name: "Demo Customer", role: "admin" } })).status === 400);
check("profile update with plan rejected", (await call("PATCH", "/api/profile", { token: tok.vendor, body: { name: "Lumen Studio", subscriptionPlan: "premium" } })).status === 400);

// --- Service details / invalid id ---
check("invalid service id -> 400", (await call("GET", "/api/services/not-an-id", { token: tok.customer })).status === 400);
check("unknown service id -> 404", (await call("GET", "/api/services/64b64b64b64b64b64b64b64b", { token: tok.customer })).status === 404);

// --- Booking rules ---
const svc = asc[0];
const date = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
const payload = { serviceId: svc._id, eventDate: date, eventLocation: "Test Hall, Khulna", message: "smoke test" };
const b1 = await call("POST", "/api/bookings", { token: tok.customer, body: payload });
check("customer books service -> 201", b1.status === 201, JSON.stringify(b1.data));
check("duplicate booking (same service+date) -> 409", (await call("POST", "/api/bookings", { token: tok.customer, body: payload })).status === 409);
check("past date rejected", (await call("POST", "/api/bookings", { token: tok.customer, body: { ...payload, eventDate: "2020-01-01" } })).status === 400);
check("admin cannot book", (await call("POST", "/api/bookings", { token: tok.admin, body: payload })).status === 403);
check("vendor cannot book own service", (await call("POST", "/api/bookings", { token: tok.vendor, body: payload })).status === 403);
const id = b1.data._id;
if (id) {
  check("customer cannot accept (vendor-only)", (await call("PATCH", `/api/vendor/bookings/${id}/status`, { token: tok.customer, body: { status: "accepted" } })).status === 403);
  check("vendor accepts pending -> 200", (await call("PATCH", `/api/vendor/bookings/${id}/status`, { token: tok.vendor, body: { status: "accepted" } })).status === 200);
  check("accepted request cannot be processed again -> 409", (await call("PATCH", `/api/vendor/bookings/${id}/status`, { token: tok.vendor, body: { status: "rejected" } })).status === 409);
  check("accepted booking cannot be cancelled -> 409", (await call("PATCH", `/api/bookings/${id}/cancel`, { token: tok.customer })).status === 409);
}

// --- Free plan limit ---
const mk = (n) => ({ serviceName: `Limit test ${n} ${Date.now()}`, category: "Wedding Venues", description: "A long enough description for the smoke test service.", price: 100, location: "Khulna", images: ["https://i.ibb.co/placeholder/test.jpg"] });
let blocked = false;
for (let i = 0; i < 4 && !blocked; i++) { const r = await call("POST", "/api/vendor/services", { token: tok.vendor, body: mk(i) }); if (r.status === 403 && r.data.code === "LIMIT_REACHED") blocked = true; }
check("free vendor blocked after 3 active services", blocked);

// --- Admin transactions are read-only ---
check("no write endpoint for transactions", (await call("PATCH", "/api/admin/transactions/x", { token: tok.admin, body: { status: "paid" } })).status === 404);
// --- Stripe webhook rejects unsigned calls ---
check("webhook without signature -> 400", (await call("POST", "/api/webhooks/stripe", { body: { type: "checkout.session.completed" } })).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
