import { z } from "zod";
import { CATEGORIES } from "./utils.js";

export const validate = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const issues = r.error.issues;
    return res.status(400).json({
      message: issues[0].message,
      errors: issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  req.body = r.data;
  next();
};

const httpsUrl = z.string().url("Invalid image URL").refine((u) => u.startsWith("https://"), "Image URL must be https");

export const serviceSchema = z.object({
  serviceName: z.string().trim().min(3, "Service name must be at least 3 characters").max(100, "Service name is too long"),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: "Select a valid category" }) }),
  description: z.string().trim().min(20, "Description must be at least 20 characters").max(2000, "Description is too long"),
  price: z.coerce.number({ invalid_type_error: "Price must be a number" }).positive("Price must be greater than 0").max(10000000, "Price is too high"),
  location: z.string().trim().min(2, "Location is required").max(100, "Location is too long"),
  images: z.array(httpsUrl).min(1, "Upload at least one service image").max(6, "You can upload up to 6 images"),
});

export const bookingSchema = z.object({
  serviceId: z.string().min(1, "Service is required"),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Event date is required").refine((d) => {
    const t = new Date(d + "T00:00:00Z");
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    return !isNaN(t) && t >= today;
  }, "Event date cannot be in the past"),
  eventLocation: z.string().trim().min(3, "Event location is required").max(200, "Event location is too long"),
  message: z.string().trim().max(1000, "Message must be 1000 characters or fewer").optional().default(""),
});

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60, "Name is too long"),
  image: z.union([httpsUrl, z.literal("")]).optional(),
  phone: z.string().trim().max(25, "Phone number is too long").regex(/^[0-9+()\-\s]*$/, "Phone number has invalid characters").optional(),
  bio: z.string().trim().max(500, "Bio must be 500 characters or fewer").optional(),
  businessName: z.string().trim().max(100, "Business name is too long").optional(),
}).strict();
