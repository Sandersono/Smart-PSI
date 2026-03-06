import { Router } from "express";
import { getCurrentProfile, checkFirstTimeSetup } from "../controllers/userController.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

router.get("/me", authenticateToken, getCurrentProfile);
router.get("/check-first-time-setup", authenticateToken, checkFirstTimeSetup);

export default router;
