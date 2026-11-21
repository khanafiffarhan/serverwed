import { MongoClient } from "mongodb";
import { env } from "./env.js";

export const client = new MongoClient(env.MONGODB_URI);
await client.connect();
export const db = client.db(env.DB_NAME);

// Better Auth owns session/account/verification/jwks. Business collections:
export const col = {
  users: db.collection("users"), // managed by Better Auth (extended with role, isBlocked, subscription...)
  services: db.collection("services"),
  bookings: db.collection("bookings"),
  transactions: db.collection("transactions"),
};

try {
  await Promise.all([
    col.users.createIndex({ email: 1 }),
    col.services.createIndex({ status: 1, isActive: 1, category: 1 }),
    col.services.createIndex({ vendorId: 1 }),
    col.bookings.createIndex({ serviceId: 1, customerId: 1, eventDate: 1 }),
    col.bookings.createIndex({ vendorId: 1, status: 1 }),
    col.transactions.createIndex({ eventKey: 1 }, { unique: true }),
    col.transactions.createIndex({ vendorId: 1, createdAt: -1 }),
  ]);
} catch (e) {
  console.error("Index creation warning:", e.message);
}
