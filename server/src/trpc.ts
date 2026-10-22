import { initTRPC } from '@trpc/server';

// Initialize tRPC
const t = initTRPC.create();
export const router = t.router;
export const publicProcedure = t.procedure;
