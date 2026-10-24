import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  full_name: string;
  email: string;
  password: string;
  plain_password?: string;
  transaction_pin?: string;
  phone?: string;
  role: 'customer' | 'admin';
  is_verified: boolean;
  is_active: boolean;
  verified_at: Date | null;
  verified_by: mongoose.Types.ObjectId | null;
  login_attempts: number;
  lock_until: Date | null;
  pin_attempts: number;
  reset_token?: string;
  reset_token_expiry?: Date;
  created_at: Date;
  created_by_admin: boolean;
  otp_code?: string;
  otp_expiry?: Date;
  country?: string;
  address?: string;
  city?: string;
  zip_code?: string;
  occupation?: string;
  ssn?: string;
  id_type?: 'id_card' | 'drivers_license';
  id_document?: string;
  utility_bill?: string;
  face_photo?: string;
  comparePassword(candidatePassword: string): Promise<boolean>;
  isLocked(): boolean;
}

const userSchema = new Schema<IUser>({
  full_name: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 8,
    select: false,
  },
  plain_password: {
    type: String,
    select: false,
  },
  transaction_pin: {
    type: String,
    select: false,
  },
  phone: {
    type: String,
    trim: true,
  },
  role: {
    type: String,
    enum: ['customer', 'admin'],
    default: 'customer',
  },
  is_verified: {
    type: Boolean,
    default: false,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  verified_at: {
    type: Date,
    default: null,
  },
  verified_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  login_attempts: {
    type: Number,
    default: 0,
  },
  lock_until: {
    type: Date,
    default: null,
  },
  // Wrong login-PIN guesses; unlike login_attempts this is not reset by a
  // successful password login, only by a correct PIN.
  pin_attempts: {
    type: Number,
    default: 0,
  },
  reset_token: {
    type: String,
    select: false,
  },
  reset_token_expiry: {
    type: Date,
    select: false,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  created_by_admin: {
    type: Boolean,
    default: false,
  },
  otp_code: {
    type: String,
    select: false,
  },
  otp_expiry: {
    type: Date,
    select: false,
  },
  country: {
    type: String,
    default: 'United States',
  },
  address: {
    type: String,
    trim: true,
  },
  city: {
    type: String,
    trim: true,
  },
  zip_code: {
    type: String,
    trim: true,
  },
  occupation: {
    type: String,
    trim: true,
  },
  ssn: {
    type: String,
    trim: true,
    select: false,
  },
  id_type: {
    type: String,
    enum: ['id_card', 'drivers_license'],
  },
  id_document: {
    type: String,
    select: false,
  },
  utility_bill: {
    type: String,
    select: false,
  },
  face_photo: {
    type: String,
    select: false,
  },
});

// Covers the admin customer list's default { role: 'customer' } filter +
// created_at sort, and the role-scoped counts used in analytics.
userSchema.index({ role: 1, created_at: -1 });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function (): boolean {
  return !!(this.lock_until && this.lock_until > new Date());
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.plain_password;
  delete obj.reset_token;
  delete obj.reset_token_expiry;
  delete obj.ssn;
  delete obj.id_document;
  delete obj.utility_bill;
  delete obj.face_photo;
  return obj;
};

export default mongoose.model<IUser>('User', userSchema);
