
import { auth } from "../src/auth.js";
import { col, client } from "../src/db.js";

const ADMIN = {
  name: process.env.ADMIN_NAME || "WedPlan Admin",
  email: (process.env.ADMIN_EMAIL || "admin@wedplan.com").toLowerCase(),
  password: process.env.ADMIN_PASSWORD || "ChangeMe123",
};

const VENDOR = {
  name: "Lumen Studio",
  email: "vendor@wedplan.demo",
  password: "Vendor123",
};

const CUSTOMER = {
  name: "Demo Customer",
  email: "customer@wedplan.demo",
  password: "Customer123",
};

async function ensureUser({ name, email, password }, role) {
  let u = await col.users.findOne({ email });

  if (!u) {
    await auth.api.signUpEmail({
      body: {
        name,
        email,
        password,
        role: "customer",
      },
    });

    u = await col.users.findOne({ email });
    console.log("Created:", email);
  }

  if (!u) {
    throw new Error(`Could not create user: ${email}`);
  }

  await col.users.updateOne(
    { _id: u._id },
    {
      $set: {
        role,
        isBlocked: false,
        needsRoleSelection: false,
      },
    }
  );

  return col.users.findOne({ _id: u._id });
}

const admin = await ensureUser(ADMIN, "admin");
const vendor = await ensureUser(VENDOR, "vendor");
await ensureUser(CUSTOMER, "customer");

await col.users.updateOne(
  { _id: vendor._id },
  {
    $set: {
      businessName: "Lumen Studio",
    },
  }
);

const vid = String(vendor._id);

const rows = [
  {
    name: "Golden Hour Wedding Photography",
    category: "Photography & Videography",
    price: 1800,
    location: "Dhaka",
    description:
      "Full-day coverage with two photographers, a cinematic highlight film and an edited gallery delivered in 3 weeks.",
    images: [
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1537633552985-df8429e8048b?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1200&q=80",
    ],
  },
  {
    name: "Riverside Garden Venue",
    category: "Wedding Venues",
    price: 4200,
    location: "Khulna",
    description:
      "An open-air garden venue for up to 300 guests, with a covered pavilion, bridal suite and on-site parking.",
    images: [
      "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1464366400608-1b5b7c1d6d0b?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1200&q=80",
    ],
  },
  {
    name: "Evergreen Floral Design",
    category: "Decoration & Florist",
    price: 950,
    location: "Chattogram",
    description:
      "Custom bouquets, arches and table centrepieces designed around your palette using seasonal flowers.",
    images: [
      "https://images.unsplash.com/photo-1523438885200-e635ba2c371e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=1200&q=80",
    ],
  },
  {
    name: "Saffron & Salt Catering",
    category: "Catering Services",
    price: 35,
    location: "Dhaka",
    description:
      "Per-guest multi-course menus with live stations, tasting session included. Vegetarian and halal options.",
    images: [
      "https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80",
    ],
  },
  {
    name: "Bridal Glow Makeup Studio",
    category: "Makeup & Styling",
    price: 420,
    location: "Sylhet",
    description:
      "Bridal makeup and hair with a trial session, plus touch-up kit for the day.",
    images: [
      "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=80",
    ],
  },
  {
    name: "Heirloom Bridal Boutique",
    category: "Wedding Fashion",
    price: 1300,
    location: "Dhaka",
    description:
      "Handcrafted bridal wear and groom sherwanis with two fittings and alterations included.",
    images: [
      "https://images.unsplash.com/photo-1594552072716-c8a0f8a4e5e5?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1591604466107-ec9f8f2e1e7b?auto=format&fit=crop&w=1200&q=80",
    ],
  },
  {
    name: "Candlelight Reception Decor",
    category: "Decoration & Florist",
    price: 1100,
    location: "Khulna",
    description:
      "Warm lighting, draping and stage design for receptions, from intimate dinners to 400-guest halls.",
    images: [
      "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1464366400608-1b5b7c1d6d0b?auto=format&fit=crop&w=1200&q=80",
    ],
  },
  {
    name: "Moments in Motion Videography",
    category: "Photography & Videography",
    price: 1500,
    location: "Rajshahi",
    description:
      "Documentary-style wedding film, drone footage and a same-week social teaser.",
    images: [
      "https://images.unsplash.com/photo-1537633552985-df8429e8048b?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80",
    ],
  },
];

const now = new Date();

// Remove the old demo services before reseeding
await col.services.deleteMany({ vendorId: vid });

await col.services.insertMany(
  rows.map((row, i) => ({
    serviceName: row.name,
    category: row.category,
    price: row.price,
    location: row.location,
    description: row.description,
    images: row.images,
    vendorId: vid,
    status: "approved",
    isActive: true,
    createdAt: new Date(now.getTime() - i * 36e5),
    updatedAt: now,
  }))
);

console.log("Inserted sample services with images");

console.log(`
Admin ready -> ${ADMIN.email} / ${ADMIN.password}
Demo vendor -> ${VENDOR.email} / ${VENDOR.password}
Demo customer -> ${CUSTOMER.email} / ${CUSTOMER.password}
`);

await client.close();
process.exit(0);
