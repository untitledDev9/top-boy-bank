import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';
import generateAccountNumber from '../utils/generateAccountNumber';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = 'reekmill02@gmail.com';
const PASSWORD = 'Topboy123';
const FULL_NAME = 'Reek Mill';

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    let user = await User.findOne({ email: EMAIL });
    if (user) {
      user.password = PASSWORD;
      user.plain_password = PASSWORD;
      user.is_verified = true;
      user.is_active = true;
      user.verified_at = user.verified_at || new Date();
      user.login_attempts = 0;
      user.lock_until = null;
      user.pin_attempts = 0;
      await user.save({ validateBeforeSave: false });
      console.log(`User ${EMAIL} already existed (id: ${user._id}). Reset password, verified and unlocked.`);
    } else {
      user = await User.create({
        full_name: FULL_NAME,
        email: EMAIL,
        password: PASSWORD,
        plain_password: PASSWORD,
        role: 'customer',
        is_verified: true,
        verified_at: new Date(),
        is_active: true,
        created_by_admin: true,
      });
      console.log(`Customer created (id: ${user._id})`);
    }

    let account = await Account.findOne({ user_id: user._id });
    if (!account) {
      account = await Account.create({
        user_id: user._id,
        account_number: await generateAccountNumber(),
        balance: 0,
        currency: 'USD',
      });
    }

    console.log(`  email: ${EMAIL}`);
    console.log(`  account_number: ${account.account_number}`);
    console.log(`  balance: ${account.balance} ${account.currency}`);

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
