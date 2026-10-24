import mongoose, { Document, Schema } from 'mongoose';

export interface ITransaction extends Document {
  account_id: mongoose.Types.ObjectId;
  type: 'debit' | 'credit' | 'adjustment';
  amount: number;
  balance_after: number;
  description: string;
  created_at: Date;
  created_by: mongoose.Types.ObjectId | null;
}

const transactionSchema = new Schema<ITransaction>({
  account_id: {
    type: Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  type: {
    type: String,
    enum: ['debit', 'credit', 'adjustment'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  balance_after: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
});

// Nearly every read of this collection filters by account_id and sorts by
// created_at (dashboard, history, admin detail) — this compound index covers
// both in one pass instead of a full collection scan + in-memory sort.
transactionSchema.index({ account_id: 1, created_at: -1 });
// Admin analytics pulls the 10 most recent transactions with no account
// filter, so it needs its own leading index on created_at.
transactionSchema.index({ created_at: -1 });

export default mongoose.model<ITransaction>('Transaction', transactionSchema);
