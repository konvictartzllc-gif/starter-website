import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

// Express app
const app = express();

// Railway requires this
const PORT = process.env.PORT || 3000;

// Fix JSON + form parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Fix CORS for your domain
app.use(
  cors({
    origin: "https://konvict-artz.com",
    credentials: true,
  })
);

// ----------------------
// API ROUTES
// ----------------------

// AUTH ROUTES
import authRoutes from "./routes/auth.js";
app.use("/api/auth", authRoutes);

// FORGOT PASSWORD ROUTES
import forgotRoutes from "./routes/forgot.js";
app.use("/api/forgot", forgotRoutes);

// Add other API routes here if needed:
// import dexRoutes from "./routes/dex.js";
// app.use("/api/dex", dexRoutes);

// import adsRoutes from "./routes/ads.js";
// app.use("/api/ads", adsRoutes);

// ----------------------
// STATIC FILES (MUST BE LAST)
// ----------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend build
app.use(express.static(path.join(__dirname, "../../client/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../../client/dist/index.html"));
});

// ----------------------
// START SERVER
// ----------------------

app.listen(PORT, () => {
  console.log(`Konvict Artz backend running on port ${PORT}`);
});
