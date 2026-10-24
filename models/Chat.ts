import mongoose, { Document, Schema } from 'mongoose';

export interface IChatMessage {
  sender: 'customer' | 'ai' | 'admin';
  text: string;
  created_at: Date;
}

export interface IChat extends Document {
  customer_id: mongoose.Types.ObjectId;
  customer_name: string;
  status: 'ai' | 'admin' | 'closed';
  admin_id: mongoose.Types.ObjectId | null;
  messages: IChatMessage[];
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    sender: { type: String, enum: ['customer', 'ai', 'admin'], required: true },
    text: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const chatSchema = new Schema<IChat>({
  customer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  customer_name: { type: String, required: true },
  status: { type: String, enum: ['ai', 'admin', 'closed'], default: 'ai' },
  admin_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  messages: [chatMessageSchema],
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  expires_at: { type: Date, default: () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), expires: 0 },
});

chatSchema.pre('save', function () {
  this.updated_at = new Date();
  // Admin chats never expire; AI/bot chats expire after 3 days of last activity
  if (this.status === 'admin') {
    this.expires_at = null as any;
  } else if (this.status !== 'closed') {
    this.expires_at = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  }
});

// Covers the admin chat list's Chat.find({ status: { $ne: 'closed' } })
// polled every second, sorted by updated_at.
chatSchema.index({ status: 1, updated_at: -1 });
// POST /chat/start looks up the customer's open chat by { customer_id, status }
// and had no index to use, so it scanned every chat.
chatSchema.index({ customer_id: 1, status: 1 });

export default mongoose.model<IChat>('Chat', chatSchema);
