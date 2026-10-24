import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Re-seeds the same admin + demo recipients used before, into the newly
// pointed-at database — using the SAME account numbers as before, since
// frontend-sonice-F/src/utils/recentRecipients.ts hardcodes them.
const ADMIN = { email: 'nice@n.com', password: '!Nice7070', full_name: 'Admin User' };

const CUSTOMERS: { full_name: string; email: string; account_number: string }[] = [
  { full_name: 'Sarah Mitchell', email: 'sarah.mitchell@demo.sterlingcrestcapital.com', account_number: '5915773142' },
  { full_name: 'James Okafor', email: 'james.okafor@demo.sterlingcrestcapital.com', account_number: '9025350109' },
  { full_name: 'Priya Chandran', email: 'priya.chandran@demo.sterlingcrestcapital.com', account_number: '3543118405' },
  { full_name: 'Michael Torres', email: 'michael.torres@demo.sterlingcrestcapital.com', account_number: '5158624372' },
  { full_name: 'Emily Zhang', email: 'emily.zhang@demo.sterlingcrestcapital.com', account_number: '1226488111' },
  { full_name: 'David Osei', email: 'david.osei@demo.sterlingcrestcapital.com', account_number: '6589653777' },
  { full_name: 'Laura Bianchi', email: 'laura.bianchi@demo.sterlingcrestcapital.com', account_number: '3745841567' },
  { full_name: 'Daniel Kim', email: 'daniel.kim@demo.sterlingcrestcapital.com', account_number: '5019482936' },
];

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log(`Connected to MongoDB (db: ${mongoose.connection.db!.databaseName})`);

    let admin = await User.findOne({ email: ADMIN.email });
    if (!admin) {
      admin = await User.create({
        full_name: ADMIN.full_name,
        email: ADMIN.email,
        password: ADMIN.password,
        role: 'admin',
        is_verified: true,
        is_active: true,
      });
      console.log(`Admin created: ${ADMIN.email} / ${ADMIN.password}`);
    } else {
      console.log(`Admin already existed: ${ADMIN.email}`);
    }

    for (const c of CUSTOMERS) {
      let user = await User.findOne({ email: c.email });
      if (!user) {
        user = await User.create({
          full_name: c.full_name,
          email: c.email,
          password: 'Demo12345',
          role: 'customer',
          is_verified: true,
          is_active: true,
          created_by_admin: true,
        });
      }

      let account = await Account.findOne({ user_id: user._id });
      if (!account) {
        account = await Account.create({
          user_id: user._id,
          account_number: c.account_number,
          balance: 0,
          currency: 'USD',
        });
      }

      console.log(`  ${c.full_name}: ${c.email} / Demo12345 — account ${account.account_number}`);
    }

    console.log('\nSeed complete.');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
