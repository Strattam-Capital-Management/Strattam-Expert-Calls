import express from 'express';
import cors from 'cors';
import { CONFIG } from './config';
import { accessCodeMiddleware, isAuthRequired } from './auth';
import './db'; // ensure schema is initialized at startup

import { authRouter } from './routes/auth';
import { disambiguateRouter } from './routes/disambiguate';
import { questionsRouter } from './routes/questions';
import { costRouter } from './routes/cost';
import { runRouter } from './routes/run';
import { cacheRouter } from './routes/cache';

const app = express();

// CORS is registered BEFORE the access-code middleware so preflight OPTIONS requests succeed
// unauthenticated (the `cors` package terminates OPTIONS requests itself by default).
// In production, CORS_ORIGINS should be set to the deployed frontend's exact URL(s)
// (comma-separated) rather than left open to a wildcard.
const corsOptions: cors.CorsOptions = {
  origin: CONFIG.corsOrigins.length > 0 ? CONFIG.corsOrigins : true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Access-Code'],
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '2mb' }));

// Shared access-code gate. Every route except /, /health, /auth/check requires it (see
// src/auth.ts for the exact allowlist and comparison logic).
app.use(accessCodeMiddleware);

app.get('/', (_req, res) => {
  res.json({
    service: 'Strattam Expert Interview Sourcer',
    status: 'ok',
    apiKeyConfigured: Boolean(CONFIG.anthropicApiKey),
    firecrawlConfigured: Boolean(CONFIG.firecrawlApiKey),
    pdlConfigured: Boolean(CONFIG.pdlApiKey),
    authRequired: isAuthRequired(),
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(authRouter);
app.use(disambiguateRouter);
app.use(questionsRouter);
app.use(costRouter);
app.use(runRouter);
app.use(cacheRouter);

// Generic error handler - last resort so an unexpected throw in a route returns clean JSON
// instead of crashing the always-on process or leaking a stack trace.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled route error]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

app.listen(CONFIG.port, () => {
  console.log(`Strattam Expert Interview Sourcer backend listening on port ${CONFIG.port}`);
  console.log(`  Anthropic API key configured: ${Boolean(CONFIG.anthropicApiKey)}`);
  console.log(`  Firecrawl API key configured: ${Boolean(CONFIG.firecrawlApiKey)}`);
  console.log(`  PDL API key configured: ${Boolean(CONFIG.pdlApiKey)}`);
  console.log(`  Access code required: ${isAuthRequired()}`);
});
