import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productImageDir = path.resolve(__dirname, "../../../client/products");

if (!fs.existsSync(productImageDir)) {
  fs.mkdirSync(productImageDir, { recursive: true });
}

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, productImageDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
      const base = path
        .basename(file.originalname || "product-image", ext)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "product-image";
      cb(null, `${Date.now()}-${base}${safeExt}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if ((file.mimetype || "").startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only image files are allowed"));
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const isAllowedImageValue = (value) => {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith("/")) return true;
  try {
    const parsed = new URL(v);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

router.use(requireAdmin);

router.post("/upload-product-image", (req, res) => {
  imageUpload.single("image")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Image must be 5MB or smaller" });
      }
      return res.status(400).json({ error: err.message || "Image upload failed" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image file was provided" });
    }

    return res.status(201).json({
      imagePath: `/products/${req.file.filename}`,
      fileName: req.file.filename,
      size: req.file.size,
    });
  });
});

router.post(
  "/products",
  [
    body("name").isString().trim().isLength({ min: 1, max: 150 }),
    body("description").optional({ checkFalsy: true }).isString().trim().isLength({ max: 1000 }),
    body("price").isFloat({ min: 0 }),
    body("image").custom(isAllowedImageValue),
    body("itemCondition").optional({ checkFalsy: true }).isIn(["refurbished", "new"]),
    body("inventory").optional({ checkFalsy: true }).isInt({ min: 0, max: 99999 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, price, image } = req.body;
    const description = (req.body.description || "").trim();
    const itemCondition = (req.body.itemCondition || "refurbished").toLowerCase();
    const inventory = req.body.inventory === undefined ? 1 : Number(req.body.inventory);
    const result = await req.app.locals.db.run(
      "INSERT INTO products (name, description, price, image, item_condition, inventory) VALUES (?, ?, ?, ?, ?, ?)",
      name.trim(),
      description,
      Number(price),
      image,
      itemCondition,
      inventory,
    );

    const row = await req.app.locals.db.get(
      "SELECT id, name, description, price, image, item_condition, inventory, created_at FROM products WHERE id = ?",
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

router.put(
  "/products/:id",
  [
    param("id").isInt({ min: 1 }),
    body("name").optional({ checkFalsy: true }).isString().trim().isLength({ min: 1, max: 150 }),
    body("description").optional({ checkFalsy: true }).isString().trim().isLength({ max: 1000 }),
    body("price").optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body("image").optional({ checkFalsy: true }).custom(isAllowedImageValue),
    body("itemCondition").optional({ checkFalsy: true }).isIn(["refurbished", "new"]),
    body("inventory").optional({ checkFalsy: true }).isInt({ min: 0, max: 99999 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const productId = Number(req.params.id);
    const fields = [];
    const values = [];

    if (req.body.name !== undefined) {
      fields.push("name = ?");
      values.push(req.body.name.trim());
    }
    if (req.body.description !== undefined) {
      fields.push("description = ?");
      values.push(req.body.description.trim());
    }
    if (req.body.price !== undefined) {
      fields.push("price = ?");
      values.push(Number(req.body.price));
    }
    if (req.body.image !== undefined) {
      fields.push("image = ?");
      values.push(req.body.image);
    }
    if (req.body.itemCondition !== undefined) {
      fields.push("item_condition = ?");
      values.push(req.body.itemCondition.toLowerCase());
    }
    if (req.body.inventory !== undefined) {
      fields.push("inventory = ?");
      values.push(Number(req.body.inventory));
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(productId);
    const sql = `UPDATE products SET ${fields.join(", ")} WHERE id = ?`;
    const result = await req.app.locals.db.run(sql, values);

    if (!result.changes) {
      return res.status(404).json({ error: "Product not found" });
    }

    const row = await req.app.locals.db.get(
      "SELECT id, name, description, price, image, item_condition, inventory, created_at FROM products WHERE id = ?",
      productId,
    );
    return res.json(row);
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
