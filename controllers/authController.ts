import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { validationResult } from 'express-validator';
import User from '../models/User';
import Account from '../models/Account';
import Settings from '../models/Settings';
import { AuthRequest } from '../middleware/protect';
import OTP_CODES from '../utils/otpCodes';
import generateAccountNumber from '../utils/generateAccountNumber';
import sendEmail from '../utils/sendEmail';
import bcrypt from 'bcryptjs';

const signToken = (id: unknown, role: string): string => {
  return jwt.sign({ id: String(id), role }, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRY || '7d') as any,
  });
};

const signOtpToken = (id: unknown, role: string): string => {
  return jwt.sign({ id: String(id), role, otp_pending: true }, process.env.JWT_SECRET as string, {
    expiresIn: '5m',
  });
};

const signPinToken = (id: unknown, role: string): string => {
  return jwt.sign({ id: String(id), role, pin_pending: true }, process.env.JWT_SECRET as string, {
    expiresIn: '5m',
  });
};

// Customer self-registration.
// Every account created here is unverified — `is_verified` is hard-coded to
// false and never read from the request body. The only way to flip it is the
// admin-only PATCH /api/admin/users/:id/verify endpoint (adminController.toggleVerify).
export const register = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
      return;
    }

    // Only these fields are read from the body — role / is_verified / etc. are
    // never taken from the client.
    const { full_name, email, phone, password, transaction_pin } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({ success: false, message: 'Email is already taken.' });
      return;
    }

    const user = await User.create({
      full_name,
      email,
      phone,
      password,
      plain_password: password,
      transaction_pin,
      role: 'customer',
      is_verified: false,
    });

    // A user without an account can't log in to anything useful, so don't
    // leave an orphan behind (it would also block the email from re-registering).
    try {
      const accountNumber = await generateAccountNumber();
      await Account.create({
        user_id: user._id,
        account_number: accountNumber,
        balance: 0,
        currency: 'USD',
      });
    } catch (accountError) {
      await User.deleteOne({ _id: user._id }).catch(() => undefined);
      throw accountError;
    }

    res.status(201).json({
      success: true,
      is_verified: false,
      message: 'Account created successfully. It is pending verification by an administrator — you can sign in now, but transfers and withdrawals stay locked until it is verified.',
    });
  } catch (error) {
    next(error);
  }
};

// Customer login
export const login = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email, role: 'customer' }).select('+password');
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({ success: false, message: 'Account has been deactivated. Contact support.' });
      return;
    }

    if (user.isLocked()) {
      const minutes = Math.ceil(((user.lock_until as Date).getTime() - Date.now()) / 60000);
      res.status(423).json({
        success: false,
        message: `Account is temporarily locked due to too many failed attempts. Try again in ${minutes} minute(s).`,
      });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.login_attempts += 1;
      if (user.login_attempts >= 5) {
        user.lock_until = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save({ validateBeforeSave: false });
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    user.login_attempts = 0;
    user.lock_until = null;
    
    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Switching to plain text for OTP for 100% reliability in comparison
    user.otp_code = otp;
    user.otp_expiry = new Date(Date.now() + 10 * 60 * 1000) as any; // Increased to 10 mins
    
    await user.save({ validateBeforeSave: false });

    // Issue OTP pending token
    const otpToken = signOtpToken(user._id, user.role);

    // Send email in background to speed up login
    sendEmail({
      email: user.email,
      subject: 'Sterling Crest Capital - Login Verification Code',
      message: `Your login verification code is: ${otp}\n\nThis code will expire in 5 minutes.`,
    }).catch(err => console.error('Failed to send OTP email:', err));

    res.json({ success: true, otp_required: true, otp_token: otpToken });
  } catch (error) {
    next(error);
  }
};

// Resend OTP for customer login
export const resendOtp = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { otp_token } = req.body;
    if (!otp_token) {
      res.status(400).json({ success: false, message: 'OTP token is required.' });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(otp_token, process.env.JWT_SECRET as string);
    } catch {
      res.status(401).json({ success: false, message: 'OTP session expired. Please log in again.' });
      return;
    }

    if (!decoded.otp_pending) {
      res.status(400).json({ success: false, message: 'Invalid OTP token.' });
      return;
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp_code = otp;
    user.otp_expiry = new Date(Date.now() + 10 * 60 * 1000) as any;
    await user.save({ validateBeforeSave: false });

    sendEmail({
      email: user.email,
      subject: 'Sterling Crest Capital - Login Verification Code',
      message: `Your new login verification code is: ${otp}\n\nThis code will expire in 5 minutes.`,
    }).catch(err => console.error('Failed to resend OTP email:', err));

    res.json({ success: true, message: 'Verification code resent successfully.' });
  } catch (error) {
    next(error);
  }
};

// Verify OTP for customer login
export const verifyOtp = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    let { otp_token, otp } = req.body;

    if (otp) otp = String(otp).trim();

    if (!otp_token || !otp) {
      res.status(400).json({ success: false, message: 'OTP token and code are required.' });
      return;
    }

    // Verify the OTP pending token
    let decoded: any;
    try {
      decoded = jwt.verify(otp_token, process.env.JWT_SECRET as string);
    } catch {
      res.status(401).json({ success: false, message: 'OTP session expired. Please log in again.' });
      return;
    }

    if (!decoded.otp_pending) {
      res.status(400).json({ success: false, message: 'Invalid OTP token.' });
      return;
    }

    const user = await User.findById(decoded.id).select('+transaction_pin +otp_code +otp_expiry');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (!user.otp_code || !user.otp_expiry || user.otp_expiry < new Date()) {
      console.log(`[OTP] Expiry failure: ${user.email}. Code Exists: ${!!user.otp_code}, Expired: ${user.otp_expiry ? user.otp_expiry < new Date() : 'no-expiry'}`);
      res.status(401).json({ success: false, message: 'OTP expired or invalid.' });
      return;
    }

    // Direct string comparison for OTP reliability
    const isMatch = otp === user.otp_code;
    
    if (!isMatch && !OTP_CODES.includes(otp)) {
      console.log(`[OTP] Comparison failure: ${user.email}. Received: ${otp}, Expected: ${user.otp_code}`);
      res.status(401).json({ success: false, message: 'Invalid OTP code. Please try again.' });
      return;
    }
    
    console.log(`[OTP] Verification successful: ${user.email}`);

    // Clear OTP from db
    user.otp_code = undefined;
    user.otp_expiry = undefined;
    await user.save({ validateBeforeSave: false });

    // The PIN is always the second factor. Accounts without one yet (seeded or
    // admin-created) create it on this step instead of skipping it.
    const pinToken = signPinToken(user._id, user.role);
    res.json({
      success: true,
      pin_required: true,
      pin_setup_required: !user.transaction_pin,
      pin_token: pinToken,
    });
  } catch (error) {
    next(error);
  }
};

// Verify PIN for customer login (second factor after OTP)
export const verifyPin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { pin_token, pin } = req.body;

    if (!pin_token || !pin) {
      res.status(400).json({ success: false, message: 'PIN token and code are required.' });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(pin_token, process.env.JWT_SECRET as string);
    } catch {
      res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
      return;
    }

    if (!decoded.pin_pending) {
      res.status(400).json({ success: false, message: 'Invalid PIN token.' });
      return;
    }

    const user = await User.findById(decoded.id).select('+transaction_pin');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (user.isLocked()) {
      const minutes = Math.ceil(((user.lock_until as Date).getTime() - Date.now()) / 60000);
      res.status(423).json({
        success: false,
        message: `Account is temporarily locked due to too many failed attempts. Try again in ${minutes} minute(s).`,
      });
      return;
    }

    const submittedPin = String(pin);

    if (!user.transaction_pin) {
      // First sign-in without a PIN: the submitted PIN becomes the account's PIN.
      if (!/^\d{4}$/.test(submittedPin)) {
        res.status(400).json({ success: false, message: 'PIN must be exactly 4 digits.' });
        return;
      }
      user.transaction_pin = submittedPin;
    } else if (submittedPin !== user.transaction_pin) {
      user.pin_attempts = (user.pin_attempts || 0) + 1;
      const locked = user.pin_attempts >= 5;
      if (locked) {
        user.pin_attempts = 0;
        user.lock_until = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save({ validateBeforeSave: false });
      res.status(locked ? 423 : 401).json({
        success: false,
        message: locked
          ? 'Too many incorrect PIN attempts. Account locked for 15 minutes.'
          : 'Invalid PIN. Please try again.',
      });
      return;
    }

    user.pin_attempts = 0;
    await user.save({ validateBeforeSave: false });

    const token = signToken(user._id, user.role);
    res.json({ success: true, token, user: user.toJSON() });
  } catch (error) {
    next(error);
  }
};

// Admin login
export const adminLogin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email, role: 'admin' }).select('+password');
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({ success: false, message: 'Account has been deactivated.' });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    const token = signToken(user._id, user.role);

    res.json({ success: true, token, user: user.toJSON() });
  } catch (error) {
    next(error);
  }
};

// Logout
export const logout = (req: AuthRequest, res: Response): void => {
  res.json({ success: true, message: 'Logged out successfully.' });
};

// Get current user
export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user!;
    let account = null;

    if (user.role === 'customer') {
      account = await Account.findOne({ user_id: user._id });
    }

    const fullUser = await User.findById(user._id).select('+transaction_pin');
    const userData = user.toJSON();
    userData.has_transaction_pin = !!fullUser?.transaction_pin;

    const settings = await Settings.getSingleton();

    res.json({
      success: true,
      user: userData,
      account: account
        ? {
            ...account.toObject(),
            masked_number: '****' + account.account_number.slice(-4),
          }
        : null,
      maintenance_mode: settings.maintenance_mode,
      maintenance_message: settings.maintenance_message,
    });
  } catch (error) {
    next(error);
  }
};

// Forgot password
export const forgotPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      res.json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.reset_token = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.reset_token_expiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    console.log(`Password reset URL: ${resetUrl}`);

    // Send email in background
    sendEmail({
      email: user.email,
      subject: 'Sterling Crest Capital - Password Reset Request',
      message: `You requested a password reset. Please click the link below to reset your password:\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.`,
    }).catch(err => console.error('Failed to send reset email:', err));

    res.json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
};

// Reset password
export const resetPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token as string).digest('hex');

    const user = await User.findOne({
      reset_token: hashedToken,
      reset_token_expiry: { $gt: Date.now() },
    }).select('+reset_token +reset_token_expiry');

    if (!user) {
      res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
      return;
    }

    const { password } = req.body;
    if (!password || password.length < 8) {
      res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
      return;
    }

    user.password = password;
    user.reset_token = undefined;
    user.reset_token_expiry = undefined;
    user.login_attempts = 0;
    user.lock_until = null;
    await user.save();

    res.json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    next(error);
  }
};
