import mongoose, { Document, Schema } from 'mongoose';

export interface IAdminPushSubscription extends Document {
  admin_id: mongoose.Types.ObjectId;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

const adminPushSubscriptionSchema = new Schema<IAdminPushSubscription>({
  admin_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  endpoint: {
    type: String,
    required: true,
  },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
});

adminPushSubscriptionSchema.index({ admin_id: 1, endpoint: 1 }, { unique: true });

export default mongoose.model<IAdminPushSubscription>('AdminPushSubscription', adminPushSubscriptionSchema);
