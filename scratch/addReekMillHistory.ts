import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';
import Transaction from '../models/Transaction';
import generateTransactionHistory from '../utils/generateTransactionHistory';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = 'reekmill02@gmail.com';
// Same starting balance the test customers get in seedTestAccounts.ts.
const FINAL_BALANCE = 5000;

// Adds ~1 year of transaction history to the Reek Mill account and sets the
// account balance to match the last transaction. Refuses to run if the account
// already has transactions, so it never duplicates history.
const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const user = await User.findOne({ email: EMAIL });
    if (!user) {
      console.error(`No user found for ${EMAIL}. Run scratch/seedReekMill.ts first.`);
      process.exit(1);
    }

    const account = await Account.findOne({ user_id: user._id });
    if (!account) {
      console.error(`No account found for ${EMAIL}. Run scratch/seedReekMill.ts first.`);
      process.exit(1);
    }

    const existing = await Transaction.countDocuments({ account_id: account._id });
    if (existing > 0) {
      console.log(`Account ${account.account_number} already has ${existing} transactions - nothing changed.`);
      process.exit(0);
    }

    const admin = await User.findOne({ role: 'admin' });

    await generateTransactionHistory({
      accountId: account._id as any,
      finalBalance: FINAL_BALANCE,
      adminId: (admin?._id ?? null) as any,
    });

    const last = await Transaction.findOne({ account_id: account._id }).sort({ created_at: -1 });
    const finalBalance = last ? last.balance_after : 0;

    account.balance = finalBalance;
    account.updated_at = new Date();
    await account.save({ validateBeforeSave: false });

    const count = await Transaction.countDocuments({ account_id: account._id });
    const first = await Transaction.findOne({ account_id: account._id }).sort({ created_at: 1 });

    console.log(`  account_number: ${account.account_number}`);
    console.log(`  transactions added: ${count}`);
    console.log(`  history span: ${first?.created_at.toISOString().slice(0, 10)} -> ${last?.created_at.toISOString().slice(0, 10)}`);
    console.log(`  balance: ${account.balance} ${account.currency}`);

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
