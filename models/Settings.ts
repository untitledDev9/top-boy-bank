import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ISettings extends Document {
  maintenance_mode: boolean;
  maintenance_message: string;
  updated_at: Date;
  updated_by: mongoose.Types.ObjectId | null;
}

interface ISettingsModel extends Model<ISettings> {
  getSingleton(): Promise<ISettings>;
}

export const DEFAULT_MAINTENANCE_MESSAGE =
  "We're performing scheduled system maintenance. Please try again shortly — we apologize for the inconvenience.";

const settingsSchema = new Schema<ISettings>({
  maintenance_mode: {
    type: Boolean,
    default: false,
  },
  maintenance_message: {
    type: String,
    default: DEFAULT_MAINTENANCE_MESSAGE,
    maxlength: 500,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
  updated_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
});

// There is only ever one Settings document — this app-wide config is not
// scoped per-user, so callers should always go through this instead of
// querying the collection directly.
settingsSchema.statics.getSingleton = async function (): Promise<ISettings> {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

export default mongoose.model<ISettings, ISettingsModel>('Settings', settingsSchema);
