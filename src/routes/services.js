import { Router } from "express";
import { col } from "../db.js";
import { verifyJwt } from "../middleware/auth.js";
import { ah, HttpError, oid, str, escapeRegex, pageParams, CATEGORIES, withVendor } from "../utils.js";

const router = Router();
const PUBLIC = { status: "approved", isActive: true };

// Public: approved + active services only. Supports search, category/location filters, price sorting, pagination.
router.get("/", ah(async (req, res) => {
  const search = str(req.query.search).trim();
  const category = str(req.query.category);
  const location = str(req.query.location).trim();
  const sort = str(req.query.sort);
  const { page, limit, skip } = pageParams(req.query, 9, 24);

  const match = { ...PUBLIC };
  if (search) match.serviceName = { $regex: escapeRegex(search), $options: "i" };
  if (category && CATEGORIES.includes(category)) match.category = category;
  if (location) match.location = { $regex: escapeRegex(location), $options: "i" };
  const sortStage = sort === "price_asc" ? { price: 1, _id: 1 } : sort === "price_desc" ? { price: -1, _id: 1 } : { createdAt: -1, _id: -1 };

  const [r] = await col.services
    .aggregate([...withVendor(match, { publicOnly: true }), { $facet: { items: [{ $sort: sortStage }, { $skip: skip }, { $limit: limit }], total: [{ $count: "n" }] } }])
    .toArray();
  res.json({ items: r.items, total: r.total[0]?.n || 0, page, limit });
}));

// Public: featured (premium vendors are promoted first)
router.get("/featured", ah(async (req, res) => {
  const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 6));
  const items = await col.services
    .aggregate([...withVendor(PUBLIC, { publicOnly: true }), { $sort: { "vendor.isPremium": -1, createdAt: -1 } }, { $limit: limit }])
    .toArray();
  res.json(items);
}));

// Private: service details (any authenticated role). Non-public services are visible only to their owner and admins.
router.get("/:id", verifyJwt, ah(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) throw new HttpError(400, "Invalid service ID", "INVALID_ID");
  const [service] = await col.services.aggregate(withVendor({ _id: id })).toArray();
  if (!service) throw new HttpError(404, "Service not found", "NOT_FOUND");
  const privileged = req.user.role === "admin" || service.vendorId === req.user.id;
  const vendorBlocked = (await col.users.countDocuments({ _id: oid(service.vendorId), isBlocked: true })) > 0;
  if (!privileged && (service.status !== "approved" || !service.isActive || vendorBlocked)) {
    throw new HttpError(404, "This service is not available", "NOT_AVAILABLE");
  }
  res.json(service);
}));

export default router;
