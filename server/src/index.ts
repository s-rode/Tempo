import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
process.env.TEMPO_LOCAL_MODE = 'true';

import * as trpcExpress from '@trpc/server/adapters/express';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import { TEMPO_LOCAL_SERVER_API_VERSION } from '../../shared/types';
import type { Server } from 'http';
import { User as UserModel } from './models/user';
import { warmLocalClassificationModel } from './services/categorization/provider';
import { initializeFocusRuntimeScheduler } from './services/focusRuntimeScheduler';
import { persistSystemBoundary, systemBoundarySchema } from './services/systemBoundary';
import { publicProcedure, router } from './trpc';

// Export tRPC utilities
export { publicProcedure, router };

// Import routers
import { activeWindowEventsRouter } from './routers/activeWindowEvents';
import { authRouter } from './routers/auth';
import { categoryRouter } from './routers/categoryRouter';
import { userRouter } from './routers/user';
import { focusRuntimeRouter } from './routers/focusRuntime';
import { analyticsRouter } from './routers/analytics';
import { goalsRouter } from './routers/goals';
import { remindersRouter } from './routers/reminders';
import { applyReminderSync, getReminderStatus, reminderSyncSchema } from './services/reminders';

// Create app router
export const appRouter = router({
  auth: authRouter,
  activeWindowEvents: activeWindowEventsRouter,
  user: userRouter,
  focusRuntime: focusRuntimeRouter,
  category: categoryRouter,
  analytics: analyticsRouter,
  goals: goalsRouter,
  reminders: remindersRouter,
});

export type AppRouter = typeof appRouter;

const app = express();
const isLocalMode = true;
const HOST = '127.0.0.1';

// Add security headers and CORS first
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  next();
});

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  })
);

app.get('/health', async (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  const model = process.env.OLLAMA_MODEL || 'qwen3:4b-instruct';
  let ollama: 'ready' | 'unavailable' | 'model_missing' = 'unavailable';

  try {
    const baseUrl = new URL(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    if (!['127.0.0.1', 'localhost', '::1'].includes(baseUrl.hostname)) {
      throw new Error('Ollama must be loopback-only in Tempo Local mode.');
    }
    const response = await fetch(new URL('/api/tags', baseUrl));
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    ollama = body.models?.some((entry) => entry.name === model) ? 'ready' : 'model_missing';
  } catch (_error) {
    ollama = 'unavailable';
  }

  res.status(mongoReady ? 200 : 503).json({
    service: 'tempo-local-server',
    apiVersion: TEMPO_LOCAL_SERVER_API_VERSION,
    processId: process.pid,
    ownerProcessId: Number(process.env.TEMPO_OWNER_PID) || null,
    database: mongoReady ? 'ready' : 'unavailable',
    ollama,
    model,
  });
});

app.use(express.json({ limit: '20mb' }));

// Per-procedure TRPCError codes provide HTTP status without inspecting user text.
app.use('/trpc', trpcExpress.createExpressMiddleware({
  router: appRouter,
  onError({ error }) { console.error('Local API request failed:', error.code); },
}));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tempo_local';

const migrationToken = process.env.TEMPO_MIGRATION_TOKEN;
let httpServer: Server | null = null;

// OS boundaries do not depend on a live/authenticated dashboard or inference.
app.post('/internal/system-boundary', async (req, res) => {
  if (!isLocalMode || !migrationToken || req.header('x-tempo-migration-token') !== migrationToken) {
    res.sendStatus(404);
    return;
  }
  const parsed = systemBoundarySchema.safeParse(req.body);
  if (!parsed.success) {
    res.sendStatus(400);
    return;
  }
  try {
    const user = await UserModel.findOne({ googleId: 'tempo-local-user' }).select('_id').lean();
    if (!user) {
      res.sendStatus(503);
      return;
    }
    await persistSystemBoundary(String(user._id), parsed.data);
    res.json({ saved: true });
  } catch {
    res.sendStatus(503);
  }
});

app.all('/internal/reminders', async (req, res) => {
  if (!isLocalMode || !migrationToken || req.header('x-tempo-migration-token') !== migrationToken) {
    res.sendStatus(404);
    return;
  }
  try {
    const user = await UserModel.findOne({ googleId: 'tempo-local-user' }).select('_id').lean();
    if (!user) {
      res.sendStatus(503);
      return;
    }
    let contextChanged = false;
    if (req.method === 'POST') {
      const input = reminderSyncSchema.safeParse(req.body);
      if (!input.success) {
        res.status(400).json({ error: 'Invalid reminder snapshot' });
        return;
      }
      contextChanged = await applyReminderSync(String(user._id), input.data);
    } else if (req.method !== 'GET') {
      res.sendStatus(405);
      return;
    }
    res.json({ ...await getReminderStatus(String(user._id)), contextChanged });
  } catch {
    res.status(500).json({ error: 'Reminder synchronization failed' });
  }
});

async function connectDatabase(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  const interruptedImport = await mongoose.connection.db
    ?.collection('tempo_import_state')
    .findOne({ state: 'copying' });
  if (interruptedImport)
    throw new Error('Complete the interrupted explicit legacy import before starting Tempo.');
  console.log('Connected to the local Tempo database.');
}

app.post('/internal/tempo-runtime/shutdown', (req, res) => {
  if (!isLocalMode || !migrationToken || req.header('x-tempo-migration-token') !== migrationToken) {
    res.sendStatus(404);
    return;
  }
  res.status(202).json({ stopping: true });
  setImmediate(() => {
    const forceExit = setTimeout(() => process.exit(0), 2_000);
    forceExit.unref();
    if (httpServer) httpServer.close(() => process.exit(0));
    else process.exit(0);
  });
});

// Start server
const PORT = Number(process.env.PORT || 3001);
const onListening = () => {
  console.log(`Server running on ${HOST || 'all interfaces'}:${PORT}`);
  // Preload asynchronously: local startup stays usable if Ollama is stopped.
  if (isLocalMode) void warmLocalClassificationModel();
};
void connectDatabase()
  .then(() => {
    // Phase deadlines belong to the local server, not an open renderer tab.
    // Reconciliation is intentionally silent after a process restart.
    void initializeFocusRuntimeScheduler();
    httpServer = HOST ? app.listen(PORT, HOST, onListening) : app.listen(PORT, onListening);
  })
  .catch(() => console.error('Local database connection failed; check MongoDB and any interrupted explicit import.'));

export { app };
