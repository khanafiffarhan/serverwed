import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { toNodeHandler } from "better-auth/node";
import { env } from "./env.js";
import { auth } from "./auth.js";
import { stripe, handleStripeEvent } from "./stripe.js";
import miscRoutes from "./routes/misc.js";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";
import vendorRoutes from "./routes/vendor.js";
import paymentRoutes from "./routes/payments.js";
import adminRoutes from "./routes/admin.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: [env.CLIENT_URL], credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));

// Better Auth (must be mounted BEFORE express.json)
app.all("/api/auth/*", toNodeHandler(auth));

// Stripe webhook needs the raw body for signature verification
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).json({ message: `Webhook signature verification failed` });
  }
  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    res.status(500).json({ message: "Webhook handler failed" }); // Stripe will retry
  }
});

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ name: "WedPlan API", status: "running" }));
app.use("/api", miscRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found" }));
app.use((_req, res) => res.status(404).json({ message: "Not found" }));

// Central error handler
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "Image must be 4MB or smaller" : err.message });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON body" });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: status >= 500 ? "Something went wrong on the server" : err.message, code: err.code });
});

if (!process.env.VERCEL) {
  app.listen(env.PORT, () => console.log(`WedPlan API listening on :${env.PORT}`));
}
export default app;
