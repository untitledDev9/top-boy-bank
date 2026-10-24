import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditLog extends Document {
  admin_id: mongoose.Types.ObjectId;
  action: string;
  target_user_id: mongoose.Types.ObjectId;
  details: Record<string, any>;
  created_at: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  admin_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  action: {
    type: String,
    required: true,
  },
  target_user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  details: {
    type: Schema.Types.Mixed,
    default: {},
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

// Covers AuditLog.find().sort({ created_at: -1 }).limit(10) in admin analytics.
auditLogSchema.index({ created_at: -1 });

export default mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
