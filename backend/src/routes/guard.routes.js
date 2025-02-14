import { Router } from "express";
import {
  registerGuard,
  loginGuard,
  logoutGuard,
  getAccessToken,
  getCurrentGuard,
  checkRefreshToken,
  getGuard,
} from "../controllers/guard.controller.js";

import { upload } from "../middleware/multer.middleware.js";
import { verifyJWTguard } from "../middleware/auth.middleware.js";

const router = Router();

// Register new guard (with avatar upload)
router.post(
  "/register",
  upload.fields([{ name: "avatar", maxCount: 1 }]),
  registerGuard
);

// Login
router.post("/login", loginGuard);

// Logout (protected route)
router.post("/logout", verifyJWTguard, logoutGuard);

// Refresh tokens
router.post("/refresh-tokens", getAccessToken);

// Get current logged-in guard (protected route)
router.get("/current-guard", verifyJWTguard, getCurrentGuard);

// Check if refresh token exists
router.get("/check-refresh", checkRefreshToken);

// Get guard by username
router.get("/:userName", getGuard);

export default router;
