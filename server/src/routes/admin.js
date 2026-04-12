import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

router.use(requireAdmin);

router.post(
  "/products",
  [
    body("name").isString().trim().isLength({ min: 1, max: 150 }),
    body("price").isFloat({ min: 0 }),
    body("image").isURL(),
    body("itemCondition").optional({ checkFalsy: true }).isIn(["refurbished", "new"]),
    body("inventory").optional({ checkFalsy: true }).isInt({ min: 0, max: 99999 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, price, image } = req.body;
    const itemCondition = (req.body.itemCondition || "refurbished").toLowerCase();
    const inventory = req.body.inventory === undefined ? 1 : Number(req.body.inventory);
    const result = await req.app.locals.db.run(
      "INSERT INTO products (name, price, image, item_condition, inventory) VALUES (?, ?, ?, ?, ?)",
      name.trim(),
      Number(price),
      image,
      itemCondition,
      inventory,
    );

    const row = await req.app.locals.db.get(
      "SELECT id, name, price, image, item_condition, inventory, created_at FROM products WHERE id = ?",
      result.lastID,
    );
    return res.status(201).json(row);
  },
);

router.delete(
  "/products/:id",
  [param("id").isInt({ min: 1 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const result = await req.app.locals.db.run("DELETE FROM products WHERE id = ?", Number(req.params.id));
    if (!result.changes) {
      return res.status(404).json({ error: "Product not found" });
    }

    return res.status(204).send();
  },
);

router.post(
  "/works",
  [body("image").isURL()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const result = await req.app.locals.db.run("INSERT INTO works (image) VALUES (?)", req.body.image);
    const row = await req.app.locals.db.get("SELECT id, image, created_at FROM works WHERE id = ?", result.lastID);
    return res.status(201).json(row);
  },
);

router.delete(
  "/works/:id",
  [param("id").isInt({ min: 1 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const result = await req.app.locals.db.run("DELETE FROM works WHERE id = ?", Number(req.params.id));
    if (!result.changes) {
      return res.status(404).json({ error: "Work item not found" });
    }

    return res.status(204).send();
  },
);

router.post(
  "/deals",
  [body("text").isString().trim().isLength({ min: 1, max: 1000 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const text = req.body.text.trim();
    const result = await req.app.locals.db.run("INSERT INTO deals (text) VALUES (?)", text);
    const row = await req.app.locals.db.get("SELECT id, text, created_at FROM deals WHERE id = ?", result.lastID);
    return res.status(201).json(row);
  },
);

router.delete(
  "/deals/:id",
  [param("id").isInt({ min: 1 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const result = await req.app.locals.db.run("DELETE FROM deals WHERE id = ?", Number(req.params.id));
    if (!result.changes) {
      return res.status(404).json({ error: "Deal not found" });
    }

    return res.status(204).send();
  },
);

router.delete(
  "/reviews/:id",
  [param("id").isInt({ min: 1 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const result = await req.app.locals.db.run("DELETE FROM reviews WHERE id = ?", Number(req.params.id));
    if (!result.changes) {
      return res.status(404).json({ error: "Review not found" });
    }

    return res.status(204).send();
  },
);

router.delete("/clear-all", async (req, res) => {
  await req.app.locals.db.exec("DELETE FROM products; DELETE FROM reviews; DELETE FROM works; DELETE FROM deals;");
  return res.status(204).send();
});

router.get("/bookings", async (req, res) => {
  const rows = await req.app.locals.db.all(
    "SELECT id, name, phone, email, service, booking_date, booking_time, notes, created_at FROM bookings ORDER BY booking_date ASC, booking_time ASC",
  );
  res.json(rows);
});

router.delete(
  "/bookings/:id",
  [param("id").isInt({ min: 1 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const result = await req.app.locals.db.run("DELETE FROM bookings WHERE id = ?", Number(req.params.id));
    if (!result.changes) {
      return res.status(404).json({ error: "Booking not found" });
    }

    return res.status(204).send();
  },
);

export default router;
