import { Router } from "express";
import { col } from "../db.js";
import { env } from "../env.js";
import { stripe } from "../stripe.js";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import { ah, HttpError, isPremium } from "../utils.js";

const router = Router();
router.use(verifyJwt, requireRole("vendor"));

// The vendor id always comes from the verified token, never from the request body.
router.post("/checkout", ah(async (req, res) => {
  const u = req.user.doc;
  if (isPremium(u)) throw new HttpError(409, "You already have an active Premium subscription", "ALREADY_PREMIUM");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: u.email,
    client_reference_id: req.user.id,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: Math.round(env.PREMIUM_PRICE_USD * 100),
        recurring: { interval: "month" },
        product_data: { name: "WedPlan Premium Vendor", description: "Unlimited active services and the Premium Vendor badge" },
      },
    }],
    metadata: { vendorId: req.user.id, plan: "premium" },
    subscription_data: { metadata: { vendorId: req.user.id, plan: "premium" } },
    success_url: `${env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.CLIENT_URL}/payment/cancel`,
  });
  res.json({ url: session.url });
}));

// Read-only status for the success page. Premium is activated ONLY by the verified webhook.
router.get("/session/:id", ah(async (req, res) => {
  let session;
  try { session = await stripe.checkout.sessions.retrieve(req.params.id); }
  catch { throw new HttpError(404, "Checkout session not found", "NOT_FOUND"); }
  if (session.metadata?.vendorId !== req.user.id) throw new HttpError(403, "This checkout session does not belong to you");
  const tx = await col.transactions.findOne({ eventKey: session.id });
  res.json({
    paymentStatus: session.payment_status,
    amount: (session.amount_total ?? 0) / 100,
    currency: session.currency,
    recorded: !!tx,
    premiumActive: isPremium(req.user.doc),
    expiresAt: req.user.doc.subscriptionExpiresAt || null,
  });
}));

// Cancel at period end (Premium stays until expiry; the webhook downgrades when Stripe ends the subscription)
router.post("/cancel-subscription", ah(async (req, res) => {
  const last = await col.transactions.findOne({ vendorId: req.user.id, stripeSubscriptionId: { $ne: null }, status: "paid" }, { sort: { createdAt: -1 } });
  if (!last) throw new HttpError(404, "No active subscription found");
  const sub = await stripe.subscriptions.update(last.stripeSubscriptionId, { cancel_at_period_end: true });
  res.json({ message: "Subscription will end at the close of the billing period", cancelAtPeriodEnd: sub.cancel_at_period_end });
}));

export default router;
