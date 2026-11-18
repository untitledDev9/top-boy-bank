import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Settings from '../models/Settings';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = 'reekmill02@gmail.com';

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const settings = await Settings.getSingleton();
    console.log(`before: maintenance_mode=${settings.maintenance_mode}`);
    settings.maintenance_mode = false;
    settings.updated_at = new Date();
    await settings.save();
    Settings.invalidatePublicCache();
    console.log(`after:  maintenance_mode=${settings.maintenance_mode}`);

    const user = await User.findOne({ email: EMAIL }).select('+transaction_pin');
    if (!user) {
      console.error(`No user found for ${EMAIL}.`);
      process.exit(1);
    }

    console.log(`before: is_verified=${user.is_verified} is_active=${user.is_active} has_pin=${!!user.transaction_pin} locked=${!!user.lock_until}`);
    user.is_verified = true;
    user.verified_at = user.verified_at || new Date();
    user.is_active = true;
    user.transaction_pin = undefined as any;
    user.pin_attempts = 0;
    user.login_attempts = 0;
    user.lock_until = null as any;
    await user.save({ validateBeforeSave: false });

    const after = await User.findOne({ email: EMAIL }).select('+transaction_pin').lean();
    console.log(`after:  is_verified=${after?.is_verified} is_active=${after?.is_active} has_pin=${!!after?.transaction_pin} locked=${!!after?.lock_until}`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

run();
