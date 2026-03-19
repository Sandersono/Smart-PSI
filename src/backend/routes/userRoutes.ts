import { Router } from "express";
import { getCurrentProfile, checkFirstTimeSetup } from "../controllers/userController.js";
import { authenticateIdentity, authenticateToken, checkTenantAccess } from "../middlewares/auth.js";

const router = Router();

router.get("/me", authenticateToken, checkTenantAccess, getCurrentProfile);
router.get("/check-first-time-setup", authenticateIdentity, checkFirstTimeSetup);

export default router;
