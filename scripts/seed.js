// Usage: npm run seed
// Creates the admin account (from env), a demo vendor + customer, and sample approved services.
import { auth } from "../src/auth.js";
import { col, client } from "../src/db.js";

const ADMIN = { name: process.env.ADMIN_NAME || "WedPlan Admin", email: (process.env.ADMIN_EMAIL || "admin@wedplan.com").toLowerCase(), password: process.env.ADMIN_PASSWORD || "ChangeMe123" };
const VENDOR = { name: "Lumen Studio", email: "vendor@wedplan.demo", password: "Vendor123" };
const CUSTOMER = { name: "Demo Customer", email: "customer@wedplan.demo", password: "Customer123" };

async function ensureUser({ name, email, password }, role) {
  let u = await col.users.findOne({ email });
  if (!u) {
    await auth.api.signUpEmail({ body: { name, email, password, role: "customer" } });
    u = await col.users.findOne({ email });
    console.log("Created", email);
  }
  await col.users.updateOne({ _id: u._id }, { $set: { role, isBlocked: false, needsRoleSelection: false } });
  return col.users.findOne({ _id: u._id });
}

const admin = await ensureUser(ADMIN, "admin");
const vendor = await ensureUser(VENDOR, "vendor");
await ensureUser(CUSTOMER, "customer");
await col.users.updateOne({ _id: vendor._id }, { $set: { businessName: "Lumen Studio" } });

if ((await col.services.countDocuments({})) === 0) {
  const vid = String(vendor._id);
  const rows = [
    ["Golden Hour Wedding Photography", "Photography & Videography", 1800, "Dhaka", "Full-day coverage with two photographers, a cinematic highlight film and an edited gallery delivered in 3 weeks."],
    ["Riverside Garden Venue", "Wedding Venues", 4200, "Khulna", "An open-air garden venue for up to 300 guests, with a covered pavilion, bridal suite and on-site parking."],
    ["Evergreen Floral Design", "Decoration & Florist", 950, "Chattogram", "Custom bouquets, arches and table centrepieces designed around your palette using seasonal flowers."],
    ["Saffron & Salt Catering", "Catering Services", 35, "Dhaka", "Per-guest multi-course menus with live stations, tasting session included. Vegetarian and halal options."],
    ["Bridal Glow Makeup Studio", "Makeup & Styling", 420, "Sylhet", "Bridal makeup and hair with a trial session, plus touch-up kit for the day."],
    ["Heirloom Bridal Boutique", "Wedding Fashion", 1300, "Dhaka", "Handcrafted bridal wear and groom sherwanis with two fittings and alterations included."],
    ["Candlelight Reception Decor", "Decoration & Florist", 1100, "Khulna", "Warm lighting, draping and stage design for receptions, from intimate dinners to 400-guest halls."],
    ["Moments in Motion Videography", "Photography & Videography", 1500, "Rajshahi", "Documentary-style wedding film, drone footage and a same-week social teaser."],
  ];
  const now = new Date();
  await col.services.insertMany(rows.map(([serviceName, category, price, location, description], i) => ({
    serviceName, category, price, location, description, images: [], vendorId: vid,
    status: "approved", isActive: true, createdAt: new Date(now - i * 36e5), updatedAt: now,
  })));
  console.log("Inserted sample services");
}
console.log(`\nAdmin ready -> ${ADMIN.email} / ${ADMIN.password}\nDemo vendor -> ${VENDOR.email} / ${VENDOR.password}\nDemo customer -> ${CUSTOMER.email} / ${CUSTOMER.password}`);
await client.close();
process.exit(0);
