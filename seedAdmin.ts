import 'dotenv/config';
import mongoose from 'mongoose';
import User from './models/User';

// Non-destructive admin seed: creates the admin if missing, otherwise resets its
// password and re-enables it. Safe to run against production (unlike seed.ts,
// which wipes users). Override defaults with ADMIN_EMAIL / ADMIN_PASSWORD.
const EMAIL = (process.env.ADMIN_EMAIL || 'Topboy@x.com').toLowerCase().trim();
const PASSWORD = process.env.ADMIN_PASSWORD || 'Topboy123';

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    const existing = await User.findOne({ email: EMAIL });
    if (existing) {
      existing.password = PASSWORD;
      existing.role = 'admin';
      existing.is_verified = true;
      existing.is_active = true;
      existing.login_attempts = 0;
      existing.lock_until = null;
      await existing.save({ validateBeforeSave: false });
      console.log(`Admin ${EMAIL} updated.`);
    } else {
      await User.create({ full_name: 'Admin User', email: EMAIL, password: PASSWORD, role: 'admin', is_verified: true, is_active: true });
      console.log(`Admin ${EMAIL} created.`);
    }
    process.exit(0);
  } catch (error) {
    console.error('Seed admin error:', error);
    process.exit(1);
  }
};

run();
