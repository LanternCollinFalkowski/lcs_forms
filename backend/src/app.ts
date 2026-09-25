import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { compressJson, errorHandler, requestId } from "./http.js";
import { loadUser, requireAuth } from "./auth/middleware.js";
import { authRouter } from "./routes/auth.js";
import { tenantsRouter } from "./routes/tenants.js";
import { attendanceRouter } from "./routes/attendance.js";
import { sitesRouter } from "./routes/sites.js";
import { activityRouter } from "./routes/activity.js";
import { usersRouter } from "./routes/users.js";
import { adminRouter } from "./routes/admin.js";
import { publicApiRouter } from "./routes/publicApi.js";
import { formsRouter } from "./routes/forms.js";
import { hotFoodsRouter } from "./routes/hotFoods.js";

/** Runaway-loop backstop for the sign-in round trip — generous on purpose. */
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false });

/** Public API: bounds a misbehaving integration, not normal WordPress traffic. */
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false });

export function createApp() {
  const app = express();
  // Behind App Service / a reverse proxy, uncomment so limiters key on the real IP.
  // app.set("trust proxy", 1);
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(compressJson);
  app.use(cookieParser());
  app.use(loadUser);
  // A session may contain many PNG signatures. Accept the larger body only
  // for an authenticated attendance write; all other JSON keeps the 1 MB cap.
  app.post("/api/attendance", requireAuth, express.json({ limit: "20mb" }));
  // One Hot Foods entry carries one signature PNG (capped at 400 KB in the route).
  app.post("/api/hot-foods", requireAuth, express.json({ limit: "2mb" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, database: "up" });
    } catch (err) {
      res.status(503).json({ ok: false, database: "unreachable", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.use("/api/auth/microsoft", authLimiter);
  app.use("/api/auth", authRouter);
  app.use("/api/forms", formsRouter);
  app.use("/api/hot-foods", hotFoodsRouter);
  app.use("/api/tenants", tenantsRouter);
  app.use("/api/attendance", attendanceRouter);
  app.use("/api/sites", sitesRouter);
  app.use("/api/activity", activityRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/v1", apiLimiter, publicApiRouter);

  app.use(errorHandler);
  return app;
}
