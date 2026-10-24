import mongoose, { Document, Schema, Model } from 'mongoose';
import TtlCache from '../utils/ttlCache';

export interface ISettings extends Document {
  maintenance_mode: boolean;
  maintenance_message: string;
  updated_at: Date;
  updated_by: mongoose.Types.ObjectId | null;
}

export interface PublicSettings {
  maintenance_mode: boolean;
  maintenance_message: string;
}

interface ISettingsModel extends Model<ISettings> {
  getSingleton(): Promise<ISettings>;
  getPublic(): Promise<PublicSettings>;
  invalidatePublicCache(): void;
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

// Read-only view of the settings for hot request paths (/auth/me, transfer,
// withdraw), which previously paid a database round trip on every call just to
// read two fields that change a few times a year. Cached briefly and cleared
// immediately by the admin endpoint that changes it, so on a single instance a
// toggle takes effect at once; other instances see it within the TTL.
// SETTINGS_CACHE_TTL_MS=0 disables the cache.
const publicSettingsCache = new TtlCache<PublicSettings>(Number(process.env.SETTINGS_CACHE_TTL_MS ?? 5000), 1);

settingsSchema.statics.getPublic = function (): Promise<PublicSettings> {
  return publicSettingsCache.getOrLoad('settings', async () => {
    const settings = await (this as ISettingsModel).getSingleton();
    return { maintenance_mode: settings.maintenance_mode, maintenance_message: settings.maintenance_message };
  });
};

settingsSchema.statics.invalidatePublicCache = function (): void {
  publicSettingsCache.clear();
};

export default mongoose.model<ISettings, ISettingsModel>('Settings', settingsSchema);
