import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const customers = await User.find({ role: 'customer' }).select('full_name email is_active is_verified');
    console.log(`\n${customers.length} customer user(s):`);
    for (const c of customers) {
      const account = await Account.findOne({ user_id: c._id }).select('account_number balance currency');
      console.log(`  - ${c.full_name} <${c.email}> active=${c.is_active} verified=${c.is_verified} account=${account?.account_number ?? 'NONE'} balance=${account?.balance ?? 'N/A'}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('List error:', error);
    process.exit(1);
  }
};

run();
