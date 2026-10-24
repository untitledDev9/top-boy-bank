import mongoose from 'mongoose';

const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI as string, {
      // Fail a request that can't reach the database in seconds rather than
      // letting it sit for the driver's 30s default.
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS ?? 10_000),
      // Abort an operation whose socket has gone silent instead of waiting forever.
      socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS ?? 45_000),
      // Driver default is 100 connections per instance; override only if your
      // Atlas tier's connection limit needs a lower ceiling.
      ...(process.env.MONGO_MAX_POOL_SIZE ? { maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) } : {}),
      // Schema indexes are built at startup by default (unchanged). Set
      // MONGO_AUTO_INDEX=false to manage indexes yourself, e.g. in production.
      autoIndex: process.env.MONGO_AUTO_INDEX !== 'false',
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error: any) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
