import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = 'nice@n.com';
const PASSWORD = '!Nice7070';
const FULL_NAME = 'Admin User';

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const existing = await User.findOne({ email: EMAIL });
    if (existing) {
      existing.password = PASSWORD;
      existing.role = 'admin';
      existing.is_verified = true;
      existing.is_active = true;
      await existing.save({ validateBeforeSave: false });
      console.log(`Admin ${EMAIL} already existed (id: ${existing._id}). Password reset.`);
      process.exit(0);
    }

    const admin = await User.create({
      full_name: FULL_NAME,
      email: EMAIL,
      password: PASSWORD,
      role: 'admin',
      is_verified: true,
      is_active: true,
    });

    console.log('Admin created:');
    console.log(`  email: ${admin.email}`);
    console.log(`  password: ${PASSWORD}`);

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
