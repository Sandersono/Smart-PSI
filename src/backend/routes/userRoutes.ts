import { Router } from "express";
import { getCurrentProfile, checkFirstTimeSetup } from "../controllers/userController.js";
import { authenticateToken, checkTenantAccess } from "../middlewares/auth.js";

const router = Router();

router.get("/me", authenticateToken, checkTenantAccess, getCurrentProfile);
router.get("/check-first-time-setup", authenticateToken, checkTenantAccess, checkFirstTimeSetup);

export default router;
