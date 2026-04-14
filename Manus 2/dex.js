// Dex AI backend routes and logic
// Source: server/src/routes/dex.js

import { randomUUID } from "crypto";
import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { Client, Environment } from "square";
import { requireAdmin, requireUser } from "../middleware/auth.js";
import { sendPromoterNotification, sendAccessCode } from "../email.js";

// ...existing code from dex.js...
