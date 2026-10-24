import bcryptjs from 'bcryptjs';

// Password hashing at cost 12 is the most expensive thing a login does. The pure
// JavaScript implementation (bcryptjs) runs on the main thread — measured at
// ~390 ms per check with event-loop stalls of ~100 ms and no parallelism, so a
// burst of logins queues up and slows every other request. The native `bcrypt`
// module does the same work on libuv's thread pool.
//
// `bcrypt` is an *optional* dependency: if it isn't installed or can't load on
// the host (no prebuilt binary, build tools missing), this silently falls back
// to bcryptjs so the app still starts. The two produce interoperable hashes
// ($2a/$2b), so passwords hashed by either keep working with the other, and the
// work factor (12) is unchanged — this affects speed, not security.
interface Hasher {
  hash(password: string, rounds: number): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
}

let hasher: Hasher;
let implementation: 'native bcrypt' | 'bcryptjs';
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  hasher = require('bcrypt') as Hasher;
  implementation = 'native bcrypt';
} catch {
  hasher = bcryptjs as unknown as Hasher;
  implementation = 'bcryptjs';
}

console.log(`[auth] password hashing: ${implementation}`);

export const BCRYPT_ROUNDS = 12;

export const hashPassword = (password: string): Promise<string> => hasher.hash(password, BCRYPT_ROUNDS);

export const verifyPassword = (password: string, hash: string): Promise<boolean> => hasher.compare(password, hash);

export const passwordHashImplementation = implementation;
