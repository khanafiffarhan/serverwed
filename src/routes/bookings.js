import { Router } from "express";
import { col } from "../db.js";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import { ah, HttpError, oid, bookingPipeline } from "../utils.js";
import { validate, bookingSchema } from "../validators.js";

const router = Router();
router.use(verifyJwt);

// Customer submits a booking request
router.post("/", validate(bookingSchema), ah(async (req, res) => {
  const { serviceId, eventDate, eventLocation, message } = req.body;
  const sid = oid(serviceId);
  if (!sid) throw new HttpError(400, "Invalid service ID", "INVALID_ID");
  const service = await col.services.findOne({ _id: sid });
  if (!service) throw new HttpError(404, "Service not found", "NOT_FOUND");

  if (req.user.role === "admin") throw new HttpError(403, "Admins cannot submit booking requests");
  if (service.vendorId === req.user.id) throw new HttpError(403, "You cannot book your own service");
  if (req.user.role !== "customer") throw new HttpError(403, "Please use a customer account to request bookings");

  const vendor = await col.users.findOne({ _id: oid(service.vendorId) });
  if (service.status !== "approved" || !service.isActive || vendor?.isBlocked) {
    throw new HttpError(400, "This service is not available for booking", "NOT_AVAILABLE");
  }
  const dup = await col.bookings.findOne({ serviceId, customerId: req.user.id, eventDate, status: { $in: ["pending", "accepted"] } });
  if (dup) throw new HttpError(409, "You already have an active booking request for this service on that date", "DUPLICATE");

  const doc = {
    serviceId, vendorId: service.vendorId, customerId: req.user.id,
    eventDate, eventLocation, message, status: "pending", createdAt: new Date(), updatedAt: new Date(),
  };
  const r = await col.bookings.insertOne(doc);
  res.status(201).json({ ...doc, _id: r.insertedId });
}));

router.get("/mine", requireRole("customer"), ah(async (req, res) => {
  res.json(await col.bookings.aggregate(bookingPipeline({ customerId: req.user.id })).toArray());
}));

router.get("/stats", requireRole("customer"), ah(async (req, res) => {
  const rows = await col.bookings.aggregate([{ $match: { customerId: req.user.id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
  const m = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  res.json({ total: rows.reduce((a, r) => a + r.n, 0), pending: m.pending || 0, accepted: m.accepted || 0, rejected: m.rejected || 0, cancelled: m.cancelled || 0 });
}));

router.get("/:id", ah(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid booking ID", "INVALID_ID");
  const [b] = await col.bookings.aggregate(bookingPipeline({ _id: id })).toArray();
  if (!b) throw new HttpError(404, "Booking not found", "NOT_FOUND");
  if (req.user.role !== "admin" && b.customerId !== req.user.id && b.vendorId !== req.user.id) throw new HttpError(403, "You cannot view this booking");
  res.json(b);
}));

// Customer cancels own pending booking
router.patch("/:id/cancel", requireRole("customer"), ah(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid booking ID", "INVALID_ID");
  const r = await col.bookings.findOneAndUpdate(
    { _id: id, customerId: req.user.id, status: "pending" },
    { $set: { status: "cancelled", updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  const doc = r?.value !== undefined ? r.value : r;
  if (!doc) {
    const existing = await col.bookings.findOne({ _id: id });
    if (!existing) throw new HttpError(404, "Booking not found", "NOT_FOUND");
    if (existing.customerId !== req.user.id) throw new HttpError(403, "You cannot modify another customer's booking");
    throw new HttpError(409, `A ${existing.status} booking cannot be cancelled`, "INVALID_STATE");
  }
  res.json(doc);
}));

export default router;
