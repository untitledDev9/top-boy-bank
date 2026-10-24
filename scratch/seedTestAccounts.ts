import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';
import generateAccountNumber from '../utils/generateAccountNumber';
import generateTransactionHistory from '../utils/generateTransactionHistory';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ADMIN = {
  full_name: 'Admin User',
  email: 'topboy@x.com',
  password: 'Topboy123',
};

const TEST_CUSTOMERS = [
  { full_name: 'Test User One', email: 'test1@topboy.com', password: 'Test1234', balance: 5000 },
  { full_name: 'Test User Two', email: 'test2@topboy.com', password: 'Test1234', balance: 5000 },
];

// Unlike seed.ts this never deletes anything, and accounts that already exist are left untouched.
const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    let admin = await User.findOne({ email: ADMIN.email });
    if (admin) {
      console.log(`Admin ${ADMIN.email} already exists (role: ${admin.role}) - left unchanged`);
    } else {
      admin = await User.create({
        full_name: ADMIN.full_name,
        email: ADMIN.email,
        password: ADMIN.password,
        role: 'admin',
        is_verified: true,
        is_active: true,
      });
      console.log(`Admin created: ${ADMIN.email} / ${ADMIN.password}`);
    }

    for (const c of TEST_CUSTOMERS) {
      const existing = await User.findOne({ email: c.email });
      if (existing) {
        console.log(`Customer ${c.email} already exists - left unchanged`);
        continue;
      }

      const user = await User.create({
        full_name: c.full_name,
        email: c.email,
        password: c.password,
        plain_password: c.password,
        role: 'customer',
        is_verified: true,
        is_active: true,
        created_by_admin: true,
      });

      const accountNumber = await generateAccountNumber();
      const account = await Account.create({
        user_id: user._id,
        account_number: accountNumber,
        balance: c.balance,
        currency: 'USD',
      });

      await generateTransactionHistory({
        accountId: account._id as any,
        finalBalance: c.balance,
        adminId: admin._id as any,
      });

      console.log(`Customer created: ${c.email} / ${c.password} (account ${accountNumber}, balance $${c.balance})`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
