import { Router } from "express";
import { col, db } from "../db.js";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import { ah, HttpError, oid, str, escapeRegex, pageParams, CATEGORIES, withVendor, publicUser } from "../utils.js";

const router = Router();
router.use(verifyJwt, requireRole("admin"));

router.get("/stats", ah(async (_req, res) => {
  const [totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions, revenue] = await Promise.all([
    col.users.countDocuments({}),
    col.users.countDocuments({ role: "vendor" }),
    col.users.countDocuments({ role: "customer" }),
    col.services.countDocuments({}),
    col.services.countDocuments({ status: "pending" }),
    col.transactions.countDocuments({}),
    col.transactions.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
  ]);
  res.json({ totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions, revenue: revenue[0]?.total || 0 });
}));

// ---------- Users ----------
router.get("/users", ah(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 10);
  const q = {};
  const search = str(req.query.search).trim();
  const role = str(req.query.role);
  if (search) { const rx = { $regex: escapeRegex(search), $options: "i" }; q.$or = [{ name: rx }, { email: rx }]; }
  if (["admin", "vendor", "customer"].includes(role)) q.role = role;
  const [items, total] = await Promise.all([
    col.users.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    col.users.countDocuments(q),
  ]);
  res.json({ items: items.map(publicUser), total, page, limit });
}));

router.get("/users/:id", ah(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid user ID", "INVALID_ID");
  const u = await col.users.findOne({ _id: id });
  if (!u) throw new HttpError(404, "User not found", "NOT_FOUND");
  const uid = String(u._id);
  const [services, bookings] = await Promise.all([
    col.services.countDocuments({ vendorId: uid }),
    col.bookings.countDocuments({ $or: [{ customerId: uid }, { vendorId: uid }] }),
  ]);
  res.json({ ...publicUser(u), stats: { services, bookings } });
}));

router.patch("/users/:id/block", ah(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid user ID", "INVALID_ID");
  if (typeof req.body?.blocked !== "boolean") throw new HttpError(400, "blocked must be true or false");
  const u = await col.users.findOne({ _id: id });
  if (!u) throw new HttpError(404, "User not found", "NOT_FOUND");
  if (u.role === "admin") throw new HttpError(403, "Admin accounts cannot be blocked");
  await col.users.updateOne({ _id: id }, { $set: { isBlocked: req.body.blocked, updatedAt: new Date() } });
  if (req.body.blocked) await db.collection("session").deleteMany({ userId: { $in: [String(id), id] } }); // force logout
  res.json({ ...publicUser(u), isBlocked: req.body.blocked });
}));

// ---------- Services ----------
router.get("/services", ah(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 10);
  const match = {};
  const search = str(req.query.search).trim();
  const status = str(req.query.status);
  const category = str(req.query.category);
  if (search) match.serviceName = { $regex: escapeRegex(search), $options: "i" };
  if (["pending", "approved", "rejected"].includes(status)) match.status = status;
  if (CATEGORIES.includes(category)) match.category = category;
  const [r] = await col.services
    .aggregate([...withVendor(match), { $facet: { items: [{ $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit }], total: [{ $count: "n" }] } }])
    .toArray();
  res.json({ items: r.items, total: r.total[0]?.n || 0, page, limit });
}));

router.patch("/services/:id/status", ah(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid service ID", "INVALID_ID");
  const status = req.body?.status;
  if (!["pending", "approved", "rejected"].includes(status)) throw new HttpError(400, "Status must be pending, approved or rejected");
  const r = await col.services.updateOne({ _id: id }, { $set: { status, updatedAt: new Date() } });
  if (!r.matchedCount) throw new HttpError(404, "Service not found", "NOT_FOUND");
  res.json({ id: String(id), status });
}));

router.delete("/services/:id", ah(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid service ID", "INVALID_ID");
  const r = await col.services.deleteOne({ _id: id });
  if (!r.deletedCount) throw new HttpError(404, "Service not found", "NOT_FOUND");
  await col.bookings.updateMany({ serviceId: String(id), status: "pending" }, { $set: { status: "cancelled", updatedAt: new Date() } });
  res.json({ message: "Service deleted" });
}));

// ---------- Transactions (read-only: there is intentionally NO write endpoint) ----------
router.get("/transactions", ah(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 10);
  const q = {};
  const status = str(req.query.status);
  if (["paid", "failed"].includes(status)) q.status = status;
  const [items, total] = await Promise.all([
    col.transactions.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    col.transactions.countDocuments(q),
  ]);
  const ids = [...new Set(items.map((t) => t.vendorId))].map(oid).filter(Boolean);
  const vendors = await col.users.find({ _id: { $in: ids } }).toArray();
  const byId = Object.fromEntries(vendors.map((v) => [String(v._id), v]));
  res.json({
    items: items.map((t) => {
      const v = byId[t.vendorId];
      return { ...t, vendor: v ? { id: t.vendorId, name: v.businessName || v.name, email: v.email, image: v.image || null } : null };
    }),
    total, page, limit,
  });
}));

export default router;
