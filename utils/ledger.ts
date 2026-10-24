import mongoose from 'mongoose';
import Account from '../models/Account';

// Atomic balance primitives.
//
// Reading a balance, changing it in memory and calling save() is a lost-update
// race: two requests that overlap both start from the same balance and the last
// write wins, so money is created or destroyed and an overdraft check can be
// passed twice. These helpers push the arithmetic and the "is there enough?"
// guard into a single server-side operation instead.

type AccountId = mongoose.Types.ObjectId | string;

export interface LeanAccount {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  account_number: string;
  balance: number;
  currency: string;
  updated_at: Date;
}

/**
 * Subtracts `amount` only if the balance covers it.
 * Resolves to the updated account, or null when funds are insufficient (or the
 * account no longer exists) — in which case nothing was changed.
 */
export const debitIfFunded = (accountId: AccountId, amount: number): Promise<LeanAccount | null> =>
  Account.findOneAndUpdate(
    { _id: accountId, balance: { $gte: amount } },
    { $inc: { balance: -amount }, $set: { updated_at: new Date() } },
    { new: true, lean: true }
  ) as unknown as Promise<LeanAccount | null>;

/** Adds `amount`. Resolves to the updated account, or null if it doesn't exist. */
export const creditAccount = (accountId: AccountId, amount: number): Promise<LeanAccount | null> =>
  Account.findOneAndUpdate(
    { _id: accountId },
    { $inc: { balance: amount }, $set: { updated_at: new Date() } },
    { new: true, lean: true }
  ) as unknown as Promise<LeanAccount | null>;

/**
 * Best-effort compensation used when a later step of a money movement fails
 * after a balance was already changed. Never throws; a failure here is logged
 * loudly because it means a balance needs manual reconciliation.
 */
export const reverseBalanceChange = async (accountId: AccountId, delta: number, context: string): Promise<void> => {
  try {
    await Account.updateOne({ _id: accountId }, { $inc: { balance: delta }, $set: { updated_at: new Date() } });
  } catch (err) {
    console.error(`[ledger] CRITICAL: could not reverse ${delta} on account ${accountId} (${context}) — reconcile manually.`, err);
  }
};
