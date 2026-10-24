import { Router } from 'express';
import { body } from 'express-validator';
import { authLimiter } from '../middleware/rateLimiter';
import protect from '../middleware/protect';
import * as ctrl from '../controllers/authController';

const router = Router();

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const registerValidation = [
  body('full_name').trim().notEmpty().withMessage('Full name is required').isLength({ max: 100 }),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Phone number is too long'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('transaction_pin').matches(/^\d{4}$/).withMessage('Transaction PIN must be exactly 4 digits'),
];

router.post('/register', authLimiter, registerValidation, ctrl.register);
router.post('/login', authLimiter, loginValidation, ctrl.login);
router.post('/verify-otp', authLimiter, ctrl.verifyOtp);
router.post('/resend-otp', authLimiter, ctrl.resendOtp);
router.post('/verify-pin', authLimiter, ctrl.verifyPin);
router.post('/admin/login', authLimiter, loginValidation, ctrl.adminLogin);
router.post('/logout', ctrl.logout);
router.get('/me', protect, ctrl.getMe);
router.post('/forgot-password', authLimiter, body('email').isEmail(), ctrl.forgotPassword);
router.post('/reset-password/:token', body('password').isLength({ min: 8 }), ctrl.resetPassword);

export default router;
