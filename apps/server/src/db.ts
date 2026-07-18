import { PrismaClient } from "@prisma/client";

/** Gemeinsam genutzte Prisma-Client-Instanz. */
export const prisma = new PrismaClient();
