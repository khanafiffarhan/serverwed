import { createLocalJWKSet, jwtVerify } from "jose";
import { auth } from "../auth.js";
import { env } from "../env.js";
import { findUserById, syncVendorPlan } from "../utils.js";

let jwks = null;
let jwksAt = 0;
async function getJwks(force = false) {
  if (!jwks || force || Date.now() - jwksAt > 5 * 60 * 1000) {
    const keys = await auth.api.getJwks();
    jwks = createLocalJWKSet(keys);
    jwksAt = Date.now();
  }
  return jwks;
}
const opts = { issuer: env.BETTER_AUTH_URL, audience: env.BETTER_AUTH_URL };

/** Verifies the Better Auth JWT, then loads the user from MongoDB (role/blocked state are NEVER trusted from the client). */
export async function verifyJwt(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Authentication required", code: "NO_TOKEN" });
    const token = header.slice(7);
    let payload;
    try {
      ({ payload } = await jwtVerify(token, await getJwks(), opts));
    } catch (e) {
      if (e.code !== "ERR_JWKS_NO_MATCHING_KEY") throw e;
      ({ payload } = await jwtVerify(token, await getJwks(true), opts)); // key rotated
    }
    const user = await findUserById(payload.sub || payload.id);
    if (!user) return res.status(401).json({ message: "Account not found", code: "NO_USER" });
    if (user.isBlocked) return res.status(403).json({ message: "Your account has been blocked", code: "BLOCKED" });
    await syncVendorPlan(user);
    req.user = { id: String(user._id), role: user.role, email: user.email, doc: user };
    next();
  } catch (e) {
    const expired = e.code === "ERR_JWT_EXPIRED";
    res.status(401).json({ message: expired ? "Session expired. Please sign in again." : "Invalid token", code: expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN" });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ message: "You do not have permission to perform this action", code: "FORBIDDEN" });
