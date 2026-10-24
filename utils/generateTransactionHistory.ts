import mongoose from 'mongoose';
import Transaction from '../models/Transaction';

interface GenerateOptions {
  accountId: mongoose.Types.ObjectId;
  finalBalance: number;
  adminId: mongoose.Types.ObjectId;
}

// Fixed seed transactions that all users share — amounts are percentages of finalBalance
const seedTransactions = [
  { type: 'credit', pct: 0.35, description: 'Salary deposit', dayOffset: -340 },
  { type: 'debit', pct: 0.02, description: 'Electric bill payment', dayOffset: -335 },
  { type: 'debit', pct: 0.015, description: 'Internet subscription', dayOffset: -330 },
  { type: 'credit', pct: 0.12, description: 'Freelance payment', dayOffset: -310 },
  { type: 'debit', pct: 0.04, description: 'Grocery purchase', dayOffset: -305 },
  { type: 'debit', pct: 0.03, description: 'Restaurant payment', dayOffset: -298 },
  { type: 'credit', pct: 0.35, description: 'Salary deposit', dayOffset: -280 },
  { type: 'debit', pct: 0.05, description: 'Online shopping', dayOffset: -275 },
  { type: 'debit', pct: 0.01, description: 'Streaming subscription', dayOffset: -270 },
  { type: 'debit', pct: 0.025, description: 'Gas station', dayOffset: -265 },
  { type: 'credit', pct: 0.08, description: 'Wire transfer received', dayOffset: -250 },
  { type: 'debit', pct: 0.06, description: 'Insurance premium', dayOffset: -245 },
  { type: 'debit', pct: 0.015, description: 'Phone bill', dayOffset: -238 },
  { type: 'credit', pct: 0.35, description: 'Salary deposit', dayOffset: -220 },
  { type: 'debit', pct: 0.1, description: 'Rent payment', dayOffset: -215 },
  { type: 'debit', pct: 0.04, description: 'Grocery purchase', dayOffset: -208 },
  { type: 'credit', pct: 0.05, description: 'Refund processed', dayOffset: -200 },
  { type: 'debit', pct: 0.02, description: 'Water bill', dayOffset: -195 },
  { type: 'debit', pct: 0.01, description: 'Gym membership', dayOffset: -190 },
  { type: 'credit', pct: 0.35, description: 'Salary deposit', dayOffset: -170 },
  { type: 'debit', pct: 0.03, description: 'Transportation', dayOffset: -165 },
  { type: 'debit', pct: 0.045, description: 'Medical payment', dayOffset: -158 },
  { type: 'credit', pct: 0.1, description: 'Commission payment', dayOffset: -145 },
  { type: 'debit', pct: 0.035, description: 'Online shopping', dayOffset: -140 },
  { type: 'debit', pct: 0.02, description: 'Electric bill payment', dayOffset: -132 },
  { type: 'credit', pct: 0.35, description: 'Salary deposit', dayOffset: -115 },
  { type: 'debit', pct: 0.04, description: 'Grocery purchase', dayOffset: -110 },
  { type: 'debit', pct: 0.015, description: 'Internet subscription', dayOffset: -105 },
  { type: 'credit', pct: 0.06, description: 'Interest earned', dayOffset: -95 },
  { type: 'debit', pct: 0.025, description: 'Restaurant payment', dayOffset: -88 },
  { type: 'credit', pct: 0.35, description: 'Salary deposit', dayOffset: -75 },
  { type: 'debit', pct: 0.1, description: 'Rent payment', dayOffset: -70 },
  { type: 'debit', pct: 0.05, description: 'Online shopping', dayOffset: -62 },
  { type: 'credit', pct: 0.07, description: 'Cash deposit', dayOffset: -50 },
  { type: 'debit', pct: 0.015, description: 'Phone bill', dayOffset: -45 },
  { type: 'debit', pct: 0.03, description: 'Gas station', dayOffset: -38 },
  { type: 'credit', pct: 0.35, description: 'Salary deposit', dayOffset: -25 },
  { type: 'debit', pct: 0.04, description: 'Grocery purchase', dayOffset: -20 },
  { type: 'debit', pct: 0.02, description: 'Water bill', dayOffset: -15 },
  { type: 'credit', pct: 0.09, description: 'Transfer from savings', dayOffset: -10 },
  { type: 'debit', pct: 0.035, description: 'Insurance premium', dayOffset: -5 },
  { type: 'debit', pct: 0.01, description: 'Streaming subscription', dayOffset: -2 },
] as const;

export default async function generateTransactionHistory({ accountId, finalBalance, adminId }: GenerateOptions): Promise<void> {
  if (finalBalance <= 0) return;

  const now = new Date();
  const MS_PER_DAY = 86400000;

  // First pass: compute what the raw final balance would be from seed percentages
  let rawBalance = 0;
  for (const txn of seedTransactions) {
    const amount = Math.round(finalBalance * txn.pct * 100) / 100;
    rawBalance = txn.type === 'credit'
      ? Math.round((rawBalance + amount) * 100) / 100
      : Math.round((rawBalance - amount) * 100) / 100;
  }

  // Initial deposit sized so the seed transactions land on finalBalance
  // Use Math.abs to ensure the deposit is never negative
  const initialDeposit = Math.max(Math.round((finalBalance - rawBalance) * 100) / 100, 0.01);

  const transactions: any[] = [];
  let balance = initialDeposit;

  // Initial deposit
  const firstDayOffset = seedTransactions[0].dayOffset;
  transactions.push({
    account_id: accountId,
    type: 'credit',
    amount: initialDeposit,
    balance_after: initialDeposit,
    description: 'Initial deposit',
    created_at: new Date(now.getTime() + (firstDayOffset - 5) * MS_PER_DAY),
    created_by: adminId,
  });

  // Seed transactions
  for (const txn of seedTransactions) {
    const amount = Math.round(finalBalance * txn.pct * 100) / 100;
    if (amount <= 0) continue;

    // Skip debits that would make balance negative
    if (txn.type === 'debit' && amount > balance) continue;

    balance = txn.type === 'credit'
      ? Math.round((balance + amount) * 100) / 100
      : Math.round((balance - amount) * 100) / 100;

    transactions.push({
      account_id: accountId,
      type: txn.type,
      amount,
      balance_after: Math.max(balance, 0),
      description: txn.description,
      created_at: new Date(now.getTime() + txn.dayOffset * MS_PER_DAY),
      created_by: adminId,
    });
  }

  await Transaction.insertMany(transactions);
}
