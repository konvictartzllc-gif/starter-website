import { Router } from "express";
import { body, validationResult } from "express-validator";
import { getDb } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { sendCustomEmail } from "../services/email.js";

const router = Router();

export const SERVICE_AREA_ZIPS = ["35580", "35501", "35579", "35148", "35549"];

const SERVICE_NAMES = new Set(["Lawn Care", "Cleaning", "Handyman", "Electronics"]);
const BOOKING_STATUSES = new Set(["new", "confirmed", "rescheduled", "completed", "cancelled"]);

function normalizeZip(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function isInServiceArea(zipCode) {
  return SERVICE_AREA_ZIPS.includes(normalizeZip(zipCode));
}

router.get("/service-area", (req, res) => {
  const zipCode = normalizeZip(req.query.zip);
  return res.json({
    zips: SERVICE_AREA_ZIPS,
    zipCode,
    inArea: zipCode ? isInServiceArea(zipCode) : null,
  });
});

router.post("/", [
  body("service").trim().notEmpty(),
  body("name").trim().notEmpty(),
  body("email").optional({ values: "falsy" }).isEmail().normalizeEmail(),
  body("phone").optional({ values: "falsy" }).trim(),
  body("zip_code").trim().notEmpty(),
  body("address").optional({ values: "falsy" }).trim(),
  body("preferred_date").optional({ values: "falsy" }).trim(),
  body("preferred_time").optional({ values: "falsy" }).trim(),
  body("notes").optional({ values: "falsy" }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const service = String(req.body.service || "").trim();
  const zipCode = normalizeZip(req.body.zip_code);
  if (!SERVICE_NAMES.has(service)) {
    return res.status(400).json({ error: "unsupported_service", message: "Choose one of the listed Konvict Artz services." });
  }
  if (!isInServiceArea(zipCode)) {
    return res.status(422).json({
      error: "outside_service_area",
      message: `We do not offer full service in ${zipCode || "that ZIP code"} yet. Current service ZIPs: ${SERVICE_AREA_ZIPS.join(", ")}.`,
      serviceArea: SERVICE_AREA_ZIPS,
    });
  }

  const db = getDb();
  const result = await db.run(
    `INSERT INTO service_bookings
      (service, name, email, phone, zip_code, address, preferred_date, preferred_time, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      service,
      req.body.name,
      req.body.email || null,
      req.body.phone || null,
      zipCode,
      req.body.address || null,
      req.body.preferred_date || null,
      req.body.preferred_time || null,
      req.body.notes || null,
    ]
  );
  const booking = await db.get("SELECT * FROM service_bookings WHERE id = ?", [result.lastID]);

  if (booking.email) {
    sendCustomEmail({
      to: booking.email,
      subject: `Konvict Artz ${booking.service} request received`,
      body:
        `Hi ${booking.name},\n\n` +
        `We received your ${booking.service} appointment request for ZIP ${booking.zip_code}. ` +
        `A Konvict Artz team member will review it and follow up to confirm the exact time.\n\n` +
        `Requested date/time: ${booking.preferred_date || "not set"} ${booking.preferred_time || ""}\n\n` +
        `Thank you,\nKonvict Artz`,
    }).catch((err) => console.warn("Booking confirmation email failed:", err.message));
  }

  return res.json({
    success: true,
    booking,
    message: "Your request is in. Konvict Artz will review it and follow up to confirm.",
  });
});

router.get("/admin", requireAdmin, async (req, res) => {
  const db = getDb();
  const bookings = await db.all("SELECT * FROM service_bookings ORDER BY created_at DESC LIMIT 200");
  return res.json({ serviceArea: SERVICE_AREA_ZIPS, bookings });
});

router.patch("/admin/:id", requireAdmin, [
  body("status").optional().isString(),
  body("notes").optional({ values: "falsy" }).trim(),
], async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid_booking_id" });

  const status = req.body.status ? String(req.body.status).trim().toLowerCase() : null;
  if (status && !BOOKING_STATUSES.has(status)) {
    return res.status(400).json({ error: "invalid_status", allowed: Array.from(BOOKING_STATUSES) });
  }

  const db = getDb();
  const current = await db.get("SELECT * FROM service_bookings WHERE id = ?", [id]);
  if (!current) return res.status(404).json({ error: "booking_not_found" });

  await db.run(
    `UPDATE service_bookings
        SET status = COALESCE(?, status),
            notes = COALESCE(?, notes),
            updated_at = datetime('now')
      WHERE id = ?`,
    [status, req.body.notes || null, id]
  );
  const booking = await db.get("SELECT * FROM service_bookings WHERE id = ?", [id]);
  return res.json({ success: true, booking });
});

export default router;
