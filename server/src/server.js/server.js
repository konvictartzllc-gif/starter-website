import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// REQUIRED FOR Railway
const PORT = process.env.PORT || 3000;

// FIX 502 ERRORS
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: "https://konvict-artz.com",
    credentials: true,
  })
);

// AUTH ROUTES
import authRoutes from "./routes/auth.js";
app.use("/api/auth", authRoutes);

// START SERVER — THIS IS THE IMPORTANT PART
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
