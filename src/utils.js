import { ObjectId } from "mongodb";
import { col } from "./db.js";

export const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];
export const FREE_ACTIVE_LIMIT = 3;
const GRACE_MS = 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const oid = (id) => (typeof id === "string" && ObjectId.isValid(id) && String(new ObjectId(id)) === id ? new ObjectId(id) : null);
export const str = (v) => (typeof v === "string" ? v : "");
export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const pageParams = (q, def = 10, max = 50) => {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q.limit) || def));
  return { page, limit, skip: (page - 1) * limit };
};

export async function findUserById(id) {
  const o = oid(String(id));
  if (!o) return null;
  return (await col.users.findOne({ _id: o })) || (await col.users.findOne({ _id: String(id) }));
}

export const isPremium = (u) =>
  !!u && u.subscriptionPlan === "premium" && u.subscriptionExpiresAt && new Date(u.subscriptionExpiresAt) > new Date();

/** Deactivate services beyond the free limit (oldest 3 stay active). */
export async function enforceFreeLimit(vendorId) {
  const active = await col.services
    .find({ vendorId, isActive: true, status: { $ne: "rejected" } })
    .sort({ createdAt: 1 })
    .toArray();
  const extra = active.slice(FREE_ACTIVE_LIMIT).map((s) => s._id);
  if (extra.length) await col.services.updateMany({ _id: { $in: extra } }, { $set: { isActive: false, updatedAt: new Date() } });
}

/** Lazily downgrade vendors whose premium has expired (after a 24h grace for renewals). */
export async function syncVendorPlan(user) {
  if (user?.role === "vendor" && user.subscriptionPlan === "premium") {
    const exp = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt).getTime() : 0;
    if (exp + GRACE_MS < Date.now()) {
      await downgradeVendor(String(user._id));
      user.subscriptionPlan = "free";
      user.subscriptionExpiresAt = null;
    }
  }
  return user;
}
export async function downgradeVendor(vendorId) {
  const o = oid(vendorId);
  if (!o) return;
  await col.users.updateOne({ _id: o }, { $set: { subscriptionPlan: "free", subscriptionExpiresAt: null, updatedAt: new Date() } });
  await enforceFreeLimit(vendorId);
}

export const publicUser = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  image: u.image || null,
  role: u.role,
  isBlocked: !!u.isBlocked,
  businessName: u.businessName || "",
  phone: u.phone || "",
  bio: u.bio || "",
  subscriptionPlan: isPremium(u) ? "premium" : "free",
  subscriptionExpiresAt: u.subscriptionExpiresAt || null,
  needsRoleSelection: !!u.needsRoleSelection,
  createdAt: u.createdAt,
});

// Aggregation helpers ---------------------------------------------------------
const nameExpr = (p) => ({
  $cond: [{ $gt: [{ $strLenCP: { $ifNull: [`$${p}.businessName`, ""] } }, 0] }, `$${p}.businessName`, `$${p}.name`],
});
export const premiumExpr = (p) => ({
  $and: [{ $eq: [`$${p}.subscriptionPlan`, "premium"] }, { $gt: [`$${p}.subscriptionExpiresAt`, "$$NOW"] }],
});

export const withVendor = (match, { publicOnly = false } = {}) => [
  { $match: match },
  { $addFields: { vOid: { $toObjectId: "$vendorId" } } },
  { $lookup: { from: "users", localField: "vOid", foreignField: "_id", as: "v" } },
  { $unwind: { path: "$v", preserveNullAndEmptyArrays: true } },
  ...(publicOnly ? [{ $match: { "v.isBlocked": { $ne: true } } }] : []),
  {
    $addFields: {
      vendor: { id: "$vendorId", name: nameExpr("v"), image: "$v.image", email: "$v.email", isPremium: premiumExpr("v") },
    },
  },
  { $project: { v: 0, vOid: 0 } },
];

export const bookingPipeline = (match) => [
  { $match: match },
  { $addFields: { sOid: { $toObjectId: "$serviceId" }, vOid: { $toObjectId: "$vendorId" }, cOid: { $toObjectId: "$customerId" } } },
  { $lookup: { from: "services", localField: "sOid", foreignField: "_id", as: "s" } },
  { $lookup: { from: "users", localField: "vOid", foreignField: "_id", as: "v" } },
  { $lookup: { from: "users", localField: "cOid", foreignField: "_id", as: "c" } },
  { $addFields: { s: { $first: "$s" }, v: { $first: "$v" }, c: { $first: "$c" } } },
  {
    $project: {
      serviceId: 1, vendorId: 1, customerId: 1, eventDate: 1, eventLocation: 1, message: 1, status: 1, createdAt: 1, updatedAt: 1,
      service: { id: "$serviceId", serviceName: "$s.serviceName", category: "$s.category", images: "$s.images", price: "$s.price", location: "$s.location" },
      vendor: { id: "$vendorId", name: nameExpr("v"), email: "$v.email", image: "$v.image", phone: "$v.phone" },
      customer: { id: "$customerId", name: "$c.name", email: "$c.email", image: "$c.image", phone: "$c.phone" },
    },
  },
  { $sort: { createdAt: -1 } },
];
