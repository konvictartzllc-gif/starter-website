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

// Load API routes BEFORE static files
import authRoutes from "./routes/auth.js";
import forgotRoutes from "./routes/forgot.js";
app.use("/api/forgot", forgotRoutes);
app.use("/api/auth", authRoutes);

// OPTIONAL: Add other API routes here
// import dexRoutes from "./routes/dex.js";
// app.use("/api/dex", dexRoutes);

// import adsRoutes from "./routes/ads.js";
// app.use("/api/ads", adsRoutes);

// Static file serving (must be LAST)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../../client/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../../client/dist/index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`Konvict Artz backend running on port ${PORT}`);
});
