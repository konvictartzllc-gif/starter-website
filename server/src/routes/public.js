import { Router } from "express";
import { body, validationResult } from "express-validator";

const router = Router();

router.get("/products", async (req, res) => {
  const rows = await req.app.locals.db.all(
    "SELECT id, name, price, image, created_at FROM products ORDER BY id DESC",
  );
  res.json(rows);
});

router.get("/reviews", async (req, res) => {
  const rows = await req.app.locals.db.all(
    "SELECT id, text, created_at FROM reviews ORDER BY id DESC",
  );
  res.json(rows);
});

router.get("/works", async (req, res) => {
  const rows = await req.app.locals.db.all(
    "SELECT id, image, created_at FROM works ORDER BY id DESC",
  );
  res.json(rows);
});

router.get("/deals", async (req, res) => {
  const rows = await req.app.locals.db.all(
    "SELECT id, text, created_at FROM deals ORDER BY id DESC",
  );
  res.json(rows);
});

router.post(
  "/reviews",
  [body("text").isString().trim().isLength({ min: 1, max: 1000 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const text = req.body.text.trim();
    const result = await req.app.locals.db.run("INSERT INTO reviews (text) VALUES (?)", text);
    const row = await req.app.locals.db.get("SELECT id, text, created_at FROM reviews WHERE id = ?", result.lastID);
    return res.status(201).json(row);
  },
);

router.post(
  "/bookings",
  [
    body("name").isString().trim().isLength({ min: 1, max: 100 }),
    body("phone").isString().trim().isLength({ min: 7, max: 20 }),
    body("email").isEmail().normalizeEmail(),
    body("service").isString().isIn(["Handyman Repair", "Cleaning Services", "Lawn Care"]),
    body("booking_date").isDate(),
    body("booking_time").matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
    body("notes").optional({ checkFalsy: true }).isString().trim().isLength({ max: 500 }),
    body("totalPrice").optional({ checkFalsy: true }).isFloat({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, phone, email, service, booking_date, booking_time, notes } = req.body;

    let totalPrice = req.body.totalPrice !== undefined ? Number(req.body.totalPrice) : null;
    const countRow = await req.app.locals.db.get("SELECT COUNT(*) AS count FROM bookings");
    const isDiscounted = totalPrice !== null && countRow.count < 3;

    if (isDiscounted) {
      totalPrice = Number((totalPrice * 0.95).toFixed(2));
    }

    const result = await req.app.locals.db.run(
      "INSERT INTO bookings (name, phone, email, service, booking_date, booking_time, notes, total_price, discounted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      name.trim(),
      phone.trim(),
      email,
      service,
      booking_date,
      booking_time,
      (notes || "").trim(),
      totalPrice,
      isDiscounted ? 1 : 0,
    );

    const row = await req.app.locals.db.get(
      "SELECT id, name, service, booking_date, booking_time, total_price, discounted, created_at FROM bookings WHERE id = ?",
      result.lastID,
    );

    return res.status(201).json({
      message: "Booking confirmed!",
      totalPrice: row.total_price,
      discountApplied: Boolean(row.discounted),
      booking: row,
    });
  },
);

export default router;
