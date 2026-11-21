import Stripe from "stripe";
import { env } from "./env.js";
import { col } from "./db.js";
import { oid, downgradeVendor } from "./utils.js";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const periodEnd = (sub) => {
  const s = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return s ? new Date(s * 1000) : new Date(Date.now() + 30 * 864e5);
};
const invoiceSubId = (inv) => {
  const s = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  return typeof s === "string" ? s : s?.id;
};

async function recordTransaction(eventKey, data) {
  await col.transactions.updateOne(
    { eventKey },
    { $setOnInsert: { eventKey, currency: "usd", plan: "premium", createdAt: new Date(), ...data } },
    { upsert: true }
  );
}
async function activatePremium(vendorId, expiresAt) {
  const o = oid(vendorId);
  if (!o) return;
  await col.users.updateOne({ _id: o, role: "vendor" }, { $set: { subscriptionPlan: "premium", subscriptionExpiresAt: expiresAt, updatedAt: new Date() } });
}

/** All premium activation happens here, only for events whose signature was verified by Stripe. */
export async function handleStripeEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.mode !== "subscription" || s.payment_status !== "paid") return;
      const vendorId = s.metadata?.vendorId;
      if (!vendorId) return;
      const sub = await stripe.subscriptions.retrieve(s.subscription);
      await recordTransaction(s.id, {
        vendorId, stripeSessionId: s.id, stripeSubscriptionId: s.subscription,
        amount: (s.amount_total ?? 0) / 100, currency: s.currency || "usd", status: "paid",
      });
      await activatePremium(vendorId, periodEnd(sub));
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const inv = event.data.object;
      if (inv.billing_reason !== "subscription_cycle") return; // first invoice handled by checkout.session.completed
      const subId = invoiceSubId(inv);
      if (!subId) return;
      const sub = await stripe.subscriptions.retrieve(subId);
      const vendorId = sub.metadata?.vendorId;
      if (!vendorId) return;
      const paid = event.type === "invoice.paid";
      await recordTransaction(inv.id, {
        vendorId, stripeSessionId: null, stripeSubscriptionId: subId,
        amount: (paid ? inv.amount_paid : inv.amount_due) / 100, currency: inv.currency || "usd", status: paid ? "paid" : "failed",
      });
      if (paid) await activatePremium(vendorId, periodEnd(sub));
      break;
    }
    case "customer.subscription.deleted": {
      const vendorId = event.data.object.metadata?.vendorId;
      if (vendorId) await downgradeVendor(vendorId);
      break;
    }
    default:
      break;
  }
}
