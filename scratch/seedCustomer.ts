import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';
import generateAccountNumber from '../utils/generateAccountNumber';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = 'ahmedsuleiman940@gmail.com';
const PASSWORD = 'Ahmed123';
const FULL_NAME = 'Ahmed Suleiman';

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const existing = await User.findOne({ email: EMAIL });
    if (existing) {
      existing.password = PASSWORD;
      existing.plain_password = PASSWORD;
      await existing.save({ validateBeforeSave: false });
      console.log(`User ${EMAIL} already existed (id: ${existing._id}). Password reset to: ${PASSWORD}`);
      process.exit(0);
    }

    const user = await User.create({
      full_name: FULL_NAME,
      email: EMAIL,
      password: PASSWORD,
      plain_password: PASSWORD,
      role: 'customer',
      is_verified: true,
      is_active: true,
      created_by_admin: true,
    });

    const accountNumber = await generateAccountNumber();
    const account = await Account.create({
      user_id: user._id,
      account_number: accountNumber,
      balance: 0,
      currency: 'USD',
    });

    console.log('Customer created:');
    console.log(`  email: ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  account_number: ${account.account_number}`);

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
