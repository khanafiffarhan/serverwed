import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { jwt } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { db, col } from "./db.js";
import { env } from "./env.js";
import { findUserById } from "./utils.js";

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z]).{6,}$/;
const PUBLIC_ROLES = ["vendor", "customer"];
// Fields a user must never be able to change through Better Auth's own update-user endpoint
const PROTECTED_FIELDS = ["role", "isBlocked", "subscriptionPlan", "subscriptionExpiresAt", "stripeCustomerId", "needsRoleSelection"];

export const auth = betterAuth({
  appName: "WedPlan",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: mongodbAdapter(db),
  trustedOrigins: [env.CLIENT_URL, env.BETTER_AUTH_URL],
  emailAndPassword: { enabled: true, minPasswordLength: 6, autoSignIn: true },
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {},
  user: {
    modelName: "users",
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "customer", input: true },
      isBlocked: { type: "boolean", required: false, defaultValue: false, input: false },
      businessName: { type: "string", required: false, input: true },
      phone: { type: "string", required: false, input: true },
      bio: { type: "string", required: false, input: true },
      subscriptionPlan: { type: "string", required: false, defaultValue: "free", input: false },
      subscriptionExpiresAt: { type: "date", required: false, input: false },
      needsRoleSelection: { type: "boolean", required: false, defaultValue: false, input: false },
      stripeCustomerId: { type: "string", required: false, input: false, returned: false },
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
  advanced: { useSecureCookies: env.IS_PROD },
  plugins: [
    jwt({
      jwt: {
        issuer: env.BETTER_AUTH_URL,
        audience: env.BETTER_AUTH_URL,
        expirationTime: "30m",
        definePayload: ({ user }) => ({ id: user.id, email: user.email }),
      },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const { password, role } = ctx.body || {};
        if (!PASSWORD_RULE.test(password || "")) {
          throw new APIError("BAD_REQUEST", {
            message: "Password must be at least 6 characters with one uppercase and one lowercase letter",
          });
        }
        if (role !== undefined && !PUBLIC_ROLES.includes(role)) {
          throw new APIError("BAD_REQUEST", { message: "Account role must be Vendor or Customer" });
        }
      }
      if (ctx.path === "/sign-in/email") {
        const email = String(ctx.body?.email || "").toLowerCase();
        const u = email && (await col.users.findOne({ email }));
        if (u?.isBlocked) throw new APIError("FORBIDDEN", { message: "Your account has been blocked. Contact support." });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const viaEmail = !!ctx?.path?.startsWith("/sign-up");
          return {
            data: {
              ...user,
              // Admin can never be created publicly. Role is whitelisted here regardless of what the client sent.
              role: PUBLIC_ROLES.includes(user.role) ? user.role : "customer",
              isBlocked: false,
              subscriptionPlan: "free",
              subscriptionExpiresAt: null,
              // Social sign-ups choose Vendor/Customer once, right after first login
              needsRoleSelection: !viaEmail,
            },
          };
        },
      },
      update: {
        before: async (data) => {
          const clean = { ...data };
          for (const k of PROTECTED_FIELDS) delete clean[k];
          return { data: clean };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const u = await findUserById(session.userId);
          if (u?.isBlocked) throw new APIError("FORBIDDEN", { message: "Your account has been blocked. Contact support." });
        },
      },
    },
  },
});
