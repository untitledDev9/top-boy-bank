import mongoose, { Document, Schema } from 'mongoose';

export type AdminNotificationType = 'message' | 'login' | 'transaction' | 'withdrawal';

export interface IAdminNotification extends Document {
  event_id: string;
  type: AdminNotificationType;
  title: string;
  message: string;
  url: string;
  created_at: Date;
  read_by: mongoose.Types.ObjectId[];
  hidden_by: mongoose.Types.ObjectId[];
}

const adminNotificationSchema = new Schema<IAdminNotification>({
  event_id: { type: String, required: true, unique: true },
  type: {
    type: String,
    enum: ['message', 'login', 'transaction', 'withdrawal'],
    required: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  url: { type: String, required: true },
  created_at: { type: Date, required: true, default: Date.now },
  read_by: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  hidden_by: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

adminNotificationSchema.index({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
adminNotificationSchema.index({ created_at: -1 });

export default mongoose.model<IAdminNotification>('AdminNotification', adminNotificationSchema);
