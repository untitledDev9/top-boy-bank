import mongoose, { Document, Schema } from 'mongoose';

export interface IPayoutMethod extends Document {
  user_id: mongoose.Types.ObjectId;
  type: 'bank' | 'card';
  nickname: string;
  bank_name?: string;
  account_number?: string;
  routing_number?: string;
  card_number?: string;
  card_expiry?: string;
  card_name?: string;
  created_at: Date;
  toMasked(): {
    _id: mongoose.Types.ObjectId;
    type: 'bank' | 'card';
    nickname: string;
    last4: string;
    bank_name?: string;
    created_at: Date;
  };
}

const payoutMethodSchema = new Schema<IPayoutMethod>({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['bank', 'card'],
    required: true,
  },
  nickname: {
    type: String,
    trim: true,
    maxlength: 40,
  },
  bank_name: { type: String, trim: true },
  account_number: { type: String, trim: true, select: false },
  routing_number: { type: String, trim: true, select: false },
  card_number: { type: String, trim: true, select: false },
  card_expiry: { type: String, trim: true, select: false },
  card_name: { type: String, trim: true, select: false },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

// Sensitive fields are select:false, so any query feeding this method must
// explicitly `.select('+account_number +card_number')` first — otherwise
// last4 silently comes back empty.
payoutMethodSchema.methods.toMasked = function () {
  const last4 =
    this.type === 'bank'
      ? String(this.account_number || '').slice(-4)
      : String(this.card_number || '').replace(/\s/g, '').slice(-4);
  return {
    _id: this._id,
    type: this.type,
    nickname: this.nickname,
    last4,
    bank_name: this.type === 'bank' ? this.bank_name : undefined,
    created_at: this.created_at,
  };
};

export default mongoose.model<IPayoutMethod>('PayoutMethod', payoutMethodSchema);
