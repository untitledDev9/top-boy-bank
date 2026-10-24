import mongoose, { Document, Schema } from 'mongoose';

export interface IAccount extends Document {
  user_id: mongoose.Types.ObjectId;
  account_number: string;
  balance: number;
  currency: string;
  updated_at: Date;
}

const accountSchema = new Schema<IAccount>({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  account_number: {
    type: String,
    unique: true,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
    trim: true,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model<IAccount>('Account', accountSchema);
