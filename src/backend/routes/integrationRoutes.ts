import { Router } from "express";
import { testIntegrations } from "../controllers/integrationController.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

// Test configurations dynamically
router.get("/test", authenticateToken, testIntegrations);

export default router;
