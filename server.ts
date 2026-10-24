// Must be the first import: loads .env before any other module is evaluated, so
// settings read at import time (cache TTLs, timeouts) see the real values.
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import mongoose from 'mongoose';
import connectDB from './config/db';
import errorHandler from './middleware/errorHandler';
import authRoutes from './routes/auth';
import customerRoutes from './routes/customer';
import adminRoutes from './routes/admin';
import chatRoutes from './routes/chat';
import { setupSocket } from './socket';

const app = express();
const server = createServer(app);

// Behind a load balancer / reverse proxy, req.ip is the proxy's address unless
// Express is told to trust it — which makes per-IP rate limiting treat every
// visitor as one client. Opt in with TRUST_PROXY=1 (number of hops) or a
// subnet/keyword such as "loopback"; unset keeps the previous behaviour.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
}

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet());

// gzip/deflate JSON responses over 1 KB (transaction lists, chat histories).
app.use(compression());

const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);
// The JSON body is parsed (and buffered in memory) before authentication, so a
// large limit lets anyone make the server hold a big payload. No client sends
// anything near the old 15 MB, so default to 100 KB; raise JSON_BODY_LIMIT if a
// route is ever added that legitimately needs more.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100kb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);

// Health check — verifies the DB connection is actually up, not just that
// the process is running. Returns 503 (not 200) when the dependency is down
// so uptime monitors and load balancers can tell real trouble from "fine."
app.get('/api/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({ status: dbConnected ? 'ok' : 'degraded' });
});

// Error handler
app.use(errorHandler);

// Socket.io
setupSocket(server, allowedOrigins);

// Node's default keep-alive timeout (5s) is shorter than the idle timeout of
// most load balancers (typically 60s). When the proxy reuses a connection the
// server has just closed, the request fails with a 502/ECONNRESET. Keep the
// server's timeout longer than the proxy's.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

const PORT = process.env.PORT || 6070;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown: stop accepting connections, let in-flight requests
// finish, then close the database — instead of dropping requests mid-write
// when the host restarts or redeploys the process.
let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    await mongoose.connection.close().catch(() => undefined);
    process.exit(0);
  });
  // Don't hang forever on a connection that never drains.
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
