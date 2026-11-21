import { Router } from "express";
import { col } from "../db.js";
import { stripe } from "../stripe.js";
import { env } from "../env.js";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import { ah, HttpError, oid, str, bookingPipeline, isPremium, FREE_ACTIVE_LIMIT } from "../utils.js";
import { validate, serviceSchema } from "../validators.js";

const router = Router();
router.use(verifyJwt, requireRole("vendor"));

const activeFilter = (vendorId) => ({ vendorId, isActive: true, status: { $ne: "rejected" } });
const unwrap = (r) => (r && r.value !== undefined ? r.value : r);

async function assertCanActivate(req, excludeId) {
  if (isPremium(req.user.doc)) return;
  const n = await col.services.countDocuments({ ...activeFilter(req.user.id), ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
  if (n >= FREE_ACTIVE_LIMIT) {
    throw new HttpError(403, `Free plan allows up to ${FREE_ACTIVE_LIMIT} active services. Upgrade to Premium to publish more.`, "LIMIT_REACHED");
  }
}
async function ownedService(req) {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid service ID", "INVALID_ID");
  const s = await col.services.findOne({ _id: id });
  if (!s) throw new HttpError(404, "Service not found", "NOT_FOUND");
  if (s.vendorId !== req.user.id) throw new HttpError(403, "You can only manage your own services");
  return s;
}

// ---------- Overview ----------
router.get("/stats", ah(async (req, res) => {
  const v = req.user.id;
  const [totalServices, activeServices, pendingBookings, acceptedBookings] = await Promise.all([
    col.services.countDocuments({ vendorId: v }),
    col.services.countDocuments(activeFilter(v)),
    col.bookings.countDocuments({ vendorId: v, status: "pending" }),
    col.bookings.countDocuments({ vendorId: v, status: "accepted" }),
  ]);
  const premium = isPremium(req.user.doc);
  res.json({ totalServices, activeServices, pendingBookings, acceptedBookings, plan: premium ? "premium" : "free", activeLimit: premium ? null : FREE_ACTIVE_LIMIT });
}));

// ---------- Services CRUD ----------
router.get("/services", ah(async (req, res) => {
  res.json(await col.services.find({ vendorId: req.user.id }).sort({ createdAt: -1 }).toArray());
}));
router.get("/services/:id", ah(async (req, res) => res.json(await ownedService(req))));

router.post("/services", validate(serviceSchema), ah(async (req, res) => {
  await assertCanActivate(req);
  const now = new Date();
  const doc = { ...req.body, vendorId: req.user.id, status: "pending", isActive: true, createdAt: now, updatedAt: now };
  const r = await col.services.insertOne(doc);
  res.status(201).json({ ...doc, _id: r.insertedId });
}));

router.put("/services/:id", validate(serviceSchema), ah(async (req, res) => {
  const s = await ownedService(req);
  if (s.status === "rejected" && s.isActive) await assertCanActivate(req, s._id);
  // Edited content goes back to review (rejected services are resubmitted as pending)
  const set = { ...req.body, status: "pending", updatedAt: new Date() };
  await col.services.updateOne({ _id: s._id, vendorId: req.user.id }, { $set: set });
  res.json({ ...s, ...set });
}));

router.patch("/services/:id/availability", ah(async (req, res) => {
  const s = await ownedService(req);
  if (typeof req.body?.isActive !== "boolean") throw new HttpError(400, "isActive must be true or false");
  if (req.body.isActive && !s.isActive && s.status !== "rejected") await assertCanActivate(req, s._id);
  await col.services.updateOne({ _id: s._id }, { $set: { isActive: req.body.isActive, updatedAt: new Date() } });
  res.json({ ...s, isActive: req.body.isActive });
}));

router.delete("/services/:id", ah(async (req, res) => {
  const s = await ownedService(req);
  await col.bookings.updateMany({ serviceId: String(s._id), status: "pending" }, { $set: { status: "cancelled", updatedAt: new Date() } });
  await col.services.deleteOne({ _id: s._id, vendorId: req.user.id });
  res.json({ message: "Service deleted" });
}));

// ---------- Booking requests ----------
router.get("/bookings", ah(async (req, res) => {
  const match = { vendorId: req.user.id };
  const status = str(req.query.status);
  if (["pending", "accepted", "rejected", "cancelled"].includes(status)) match.status = status;
  res.json(await col.bookings.aggregate(bookingPipeline(match)).toArray());
}));

router.patch("/bookings/:id/status", ah(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid booking ID", "INVALID_ID");
  const status = req.body?.status;
  if (!["accepted", "rejected"].includes(status)) throw new HttpError(400, "Status must be accepted or rejected");
  const doc = unwrap(await col.bookings.findOneAndUpdate(
    { _id: id, vendorId: req.user.id, status: "pending" }, // atomic: only pending, only own
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: "after" }
  ));
  if (!doc) {
    const b = await col.bookings.findOne({ _id: id });
    if (!b) throw new HttpError(404, "Booking not found", "NOT_FOUND");
    if (b.vendorId !== req.user.id) throw new HttpError(403, "You cannot modify another vendor's booking requests");
    throw new HttpError(409, `This request was already ${b.status} and cannot be processed again`, "INVALID_STATE");
  }
  res.json(doc);
}));

// ---------- Subscription info ----------
router.get("/subscription", ah(async (req, res) => {
  const u = req.user.doc;
  const premium = isPremium(u);
  let cancelAtPeriodEnd = false;
  if (premium) {
    const last = await col.transactions.findOne({ vendorId: req.user.id, stripeSubscriptionId: { $ne: null }, status: "paid" }, { sort: { createdAt: -1 } });
    if (last) {
      try {
        const sub = await stripe.subscriptions.retrieve(last.stripeSubscriptionId);
        cancelAtPeriodEnd = !!sub.cancel_at_period_end;
      } catch { /* ignore */ }
    }
  }
  res.json({ plan: premium ? "premium" : "free", expiresAt: premium ? u.subscriptionExpiresAt : null, cancelAtPeriodEnd, priceUsd: env.PREMIUM_PRICE_USD, activeLimit: premium ? null : FREE_ACTIVE_LIMIT });
}));

export default router;
