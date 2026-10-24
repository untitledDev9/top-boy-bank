import { Response, NextFunction } from 'express';
import { AuthRequest } from './protect';

const adminOnly = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).json({ success: false, message: 'Admin access only.' });
};

export default adminOnly;
