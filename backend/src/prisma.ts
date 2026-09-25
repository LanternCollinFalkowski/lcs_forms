import { PrismaClient } from "@prisma/client";

/** Shared Prisma client singleton. */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
});
