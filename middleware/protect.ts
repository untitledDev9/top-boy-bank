import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import TtlCache from '../utils/ttlCache';

export interface AuthRequest extends Request {
  user?: IUser;
}

// Every authenticated request used to load the user from the database, and the
// chat widgets poll once a second — so this lookup was a database round trip on
// almost every request. The user record is cached briefly (plain object, keyed
// by the id from an already-verified token, so it can never be served to
// another user) and each request gets its own freshly hydrated document, so
// nothing is shared between requests.
//
// Anything that changes what this middleware checks — deactivating, verifying,
// deleting or renaming a user — must call invalidateUserCache(). On a single
// instance that takes effect immediately; with several instances the others
// pick it up when the TTL lapses. AUTH_USER_CACHE_TTL_MS=0 disables the cache.
type LeanUser = Record<string, any>;
const userCache = new TtlCache<LeanUser | null>(Number(process.env.AUTH_USER_CACHE_TTL_MS ?? 5000));

export const invalidateUserCache = (userId: unknown): void => {
  userCache.delete(String(userId));
};

const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      res.status(401).json({ success: false, message: 'Not authorized. Please log in.' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
      id: string;
      role: string;
      otp_pending?: boolean;
      pin_pending?: boolean;
    };

    // Mid-login tokens (issued after the password / OTP step) are only valid for
    // /auth/verify-otp, /auth/resend-otp and /auth/verify-pin, never as a session.
    if (decoded.otp_pending || decoded.pin_pending) {
      res.status(401).json({ success: false, message: 'Login not completed. Please sign in again.' });
      return;
    }

    const raw = await userCache.getOrLoad(decoded.id, async () => (await User.findById(decoded.id).lean()) as LeanUser | null);

    if (!raw) {
      res.status(401).json({ success: false, message: 'User no longer exists.' });
      return;
    }

    // hydrate() builds a document from the plain object without touching the
    // database, applying schema defaults exactly as a normal find would.
    const user = User.hydrate(raw) as IUser;

    if (!user.is_active) {
      res.status(401).json({ success: false, message: 'Account has been deactivated.' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

export default protect;
