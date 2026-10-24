import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/db';
import errorHandler from './middleware/errorHandler';
import authRoutes from './routes/auth';
import customerRoutes from './routes/customer';
import adminRoutes from './routes/admin';
import chatRoutes from './routes/chat';
import { setupSocket } from './socket';

dotenv.config();

const app = express();
const server = createServer(app);

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet());

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
app.use(express.json({ limit: '15mb' }));

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

const PORT = process.env.PORT || 6070;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
