import { v4 as uuidv4 } from "uuid";

export async function ensureAffiliateRecord(db, userId) {
  const existing = await db.get("SELECT * FROM affiliates WHERE user_id = ?", [userId]);
  if (existing) return existing;

  const promoCode = `DEX${uuidv4().slice(0, 6).toUpperCase()}`;
  await db.run(
    "INSERT INTO affiliates (user_id, promo_code) VALUES (?, ?)",
    [userId, promoCode]
  );
  return db.get("SELECT * FROM affiliates WHERE user_id = ?", [userId]);
}
