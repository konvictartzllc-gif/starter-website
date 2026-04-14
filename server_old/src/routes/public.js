import { Router } from "express";
import { body, validationResult } from "express-validator";

const router = Router();

router.get("/products", async (req, res) => {
  const rows = await req.app.locals.db.all(
    "SELECT id, name, description, price, image, item_condition, inventory, created_at FROM products ORDER BY id DESC",
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

router.post(
  "/checkout",
  [
    body("productId").isInt({ min: 1 }),
    body("quantity").isInt({ min: 1, max: 999 }),
    body("sourceId").isString().trim().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, quantity, sourceId } = req.body;
    const product = await req.app.locals.db.get(
      "SELECT id, name, price, inventory FROM products WHERE id = ?",
      productId,
    );

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (product.inventory < quantity) {
      return res.status(400).json({ error: "Not enough inventory" });
    }

    const amountCents = Math.round(Number(product.price) * quantity * 100);
    const { Client, Environment } = await import("square");

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;

    if (!accessToken || !locationId) {
      return res.status(503).json({ error: "Square payment is not configured" });
    }

    const env = String(process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase() === "production"
      ? Environment.Production
      : Environment.Sandbox;

    const squareClient = new Client({ accessToken, environment: env });

    try {
      const { randomUUID } = await import("crypto");
      const idempotencyKey = randomUUID();

      const payment = await squareClient.paymentsApi.createPayment({
        sourceId,
        idempotencyKey,
        amountMoney: { amount: amountCents, currency: "USD" },
        locationId,
      });

      const squarePaymentId = payment?.result?.payment?.id || null;
      const status = payment?.result?.payment?.status || "COMPLETED";

      await req.app.locals.db.run(
        "UPDATE products SET inventory = inventory - ? WHERE id = ?",
        quantity,
        productId,
      );

      return res.json({ 
        success: true, 
        paymentId: squarePaymentId, 
        status, 
        product: product.name, 
        quantity,
        total: (Number(product.price) * quantity).toFixed(2)
      });
    } catch (err) {
      return res.status(502).json({ error: err.message || "Payment failed" });
    }
  },
);

export default router;
