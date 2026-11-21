import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { env } from "../env.js";
import { col } from "../db.js";
import { verifyJwt } from "../middleware/auth.js";
import { ah, HttpError, CATEGORIES, publicUser, oid } from "../utils.js";
import { validate, profileSchema } from "../validators.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true, service: "wedplan-api" }));

router.get("/categories", ah(async (_req, res) => {
  const counts = await col.services.aggregate([{ $match: { status: "approved", isActive: true } }, { $group: { _id: "$category", count: { $sum: 1 } } }]).toArray();
  const map = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  res.json(CATEGORIES.map((name) => ({ name, count: map[name] || 0 })));
}));

// ---- Image upload (ImgBB). The API key stays on the server. ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) ? cb(null, true) : cb(new HttpError(400, "Only JPG, PNG, WEBP or GIF images are allowed")),
});
const uploadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { message: "Too many uploads. Try again later." } });

router.post("/upload", uploadLimiter, upload.single("image"), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, "No image file provided");
  const body = new URLSearchParams();
  body.set("key", env.IMGBB_API_KEY);
  body.set("image", req.file.buffer.toString("base64"));
  const r = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.success) throw new HttpError(502, "Image upload failed. Please try again.");
  res.status(201).json({ url: json.data.display_url || json.data.url });
}));

// ---- Current user / profile ----
router.get("/me", verifyJwt, (req, res) => res.json(publicUser(req.user.doc)));

router.patch("/profile", verifyJwt, validate(profileSchema), ah(async (req, res) => {
  // Whitelist: role, isBlocked and subscription fields can never be set here.
  const { name, image, phone, bio, businessName } = req.body;
  const set = { name, updatedAt: new Date() };
  if (image !== undefined) set.image = image || null;
  if (phone !== undefined) set.phone = phone;
  if (bio !== undefined) set.bio = bio;
  if (businessName !== undefined && req.user.role === "vendor") set.businessName = businessName;
  await col.users.updateOne({ _id: req.user.doc._id }, { $set: set });
  res.json(publicUser({ ...req.user.doc, ...set }));
}));

// One-time Vendor/Customer choice for accounts created through Google
router.post("/me/choose-role", verifyJwt, ah(async (req, res) => {
  const { role } = req.body || {};
  if (!req.user.doc.needsRoleSelection) throw new HttpError(403, "Role has already been chosen");
  if (!["vendor", "customer"].includes(role)) throw new HttpError(400, "Role must be Vendor or Customer");
  await col.users.updateOne({ _id: req.user.doc._id }, { $set: { role, needsRoleSelection: false, updatedAt: new Date() } });
  res.json(publicUser({ ...req.user.doc, role, needsRoleSelection: false }));
}));

export default router;
