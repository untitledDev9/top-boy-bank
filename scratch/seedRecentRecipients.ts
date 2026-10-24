import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';
import generateAccountNumber from '../utils/generateAccountNumber';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Matches the demo names in frontend-sonice-F/src/utils/recentRecipients.ts —
// creates real, verified, active accounts so the "recent recipients" quick-pick
// chips resolve via /customer/lookup-account instead of 404ing.
const NAMES = [
  'Sarah Mitchell',
  'James Okafor',
  'Priya Chandran',
  'Michael Torres',
  'Emily Zhang',
  'David Osei',
  'Laura Bianchi',
  'Daniel Kim',
];

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, '.');

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const results: { name: string; email: string; account_number: string }[] = [];

    for (const full_name of NAMES) {
      const email = `${slugify(full_name)}@demo.sterlingcrestcapital.com`;
      let user = await User.findOne({ email });
      if (!user) {
        user = await User.create({
          full_name,
          email,
          password: 'Demo12345',
          role: 'customer',
          is_verified: true,
          is_active: true,
          created_by_admin: true,
        });
      }

      let account = await Account.findOne({ user_id: user._id });
      if (!account) {
        const accountNumber = await generateAccountNumber();
        account = await Account.create({
          user_id: user._id,
          account_number: accountNumber,
          balance: 0,
          currency: 'USD',
        });
      }

      results.push({ name: full_name, email, account_number: account.account_number });
    }

    console.log('\nSeeded recipients:');
    for (const r of results) {
      console.log(`  { id: '${r.account_number}', name: '${r.name}', addedAt: 0 },`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
