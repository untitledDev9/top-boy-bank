import mongoose from 'mongoose';
import Account from '../models/Account';
import TtlCache from './ttlCache';

// A user's account _id never changes after creation, so list endpoints that
// only need it as a query filter (e.g. transaction history) don't have to look
// it up again on every call. Balances are NOT cached here — anything that needs
// a balance must read it fresh. ACCOUNT_ID_CACHE_TTL_MS=0 disables the cache.
const cache = new TtlCache<string | null>(Number(process.env.ACCOUNT_ID_CACHE_TTL_MS ?? 60_000));

export const getAccountIdForUser = (userId: unknown): Promise<string | null> =>
  cache.getOrLoad(String(userId), async () => {
    const account = await Account.findOne({ user_id: userId as mongoose.Types.ObjectId }).select('_id').lean();
    return account ? String(account._id) : null;
  });

export const invalidateAccountIdCache = (userId: unknown): void => {
  cache.delete(String(userId));
};
