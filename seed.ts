import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User';
import Account from './models/Account';
import AuditLog from './models/AuditLog';
import generateAccountNumber from './utils/generateAccountNumber';
import generateTransactionHistory from './utils/generateTransactionHistory';

dotenv.config();

const seed = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    // Clear users, accounts, and audit logs — keep transaction history
    await User.deleteMany({});
    await Account.deleteMany({});
    await AuditLog.deleteMany({});
    console.log('Cleared users, accounts, and audit logs (transactions preserved)');

    // Create admin
    const admin = await User.create({
      full_name: 'Admin User',
      email: 'Topboy@x.com',
      password: 'Topboy123',
      role: 'admin',
      is_verified: true,
      is_active: true,
    });
    console.log('Admin created: Topboy@x.com / Topboy123');

    // Create a demo customer with a funded account and transaction history
    const customerPassword = 'Customer123';
    const customer = await User.create({
      full_name: 'John Doe',
      email: 'customer@topboy.com',
      password: customerPassword,
      plain_password: customerPassword,
      role: 'customer',
      is_verified: true,
      is_active: true,
      created_by_admin: true,
    });

    const accountNumber = await generateAccountNumber();
    const startingBalance = 5000;
    const account = await Account.create({
      user_id: customer._id,
      account_number: accountNumber,
      balance: startingBalance,
      currency: 'USD',
    });

    await generateTransactionHistory({
      accountId: account._id as any,
      finalBalance: startingBalance,
      adminId: admin._id as any,
    });

    console.log(`Customer created: customer@topboy.com / ${customerPassword} (account ${accountNumber})`);

    console.log('\nSeed complete! Admin and demo customer accounts ready.');
    console.log('Use the admin panel to create further customer accounts.');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seed();
