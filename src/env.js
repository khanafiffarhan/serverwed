import "dotenv/config";

const required = [
  "MONGODB_URI",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CLIENT_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "IMGBB_API_KEY",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  if (!process.env.VERCEL) process.exit(1);
}
const trim = (v = "") => v.replace(/\/+$/, "");

export const env = {
  PORT: Number(process.env.PORT) || 5000,
  IS_PROD: process.env.NODE_ENV === "production",
  CLIENT_URL: trim(process.env.CLIENT_URL),
  MONGODB_URI: process.env.MONGODB_URI,
  DB_NAME: process.env.DB_NAME || "wedplan",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: trim(process.env.BETTER_AUTH_URL),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  PREMIUM_PRICE_USD: Number(process.env.PREMIUM_PRICE_USD) || 19,
  IMGBB_API_KEY: process.env.IMGBB_API_KEY,
};
