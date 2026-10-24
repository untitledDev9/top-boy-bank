import { Router } from 'express';
import { body } from 'express-validator';
import protect from '../middleware/protect';
import * as ctrl from '../controllers/customerController';

const router = Router();

router.use(protect);

router.get('/me', ctrl.getMe);
router.get('/transactions', ctrl.getTransactions);

// Bank/card fields are only required when the customer isn't paying via a
// previously-saved payout method.
const requiresBankFields = (_: any, { req }: any) => req.body.method === 'bank' && !req.body.payout_method_id;
const requiresCardFields = (_: any, { req }: any) => req.body.method === 'card' && !req.body.payout_method_id;

router.post(
  '/withdraw',
  [
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
    body('method').isIn(['bank', 'card']).withMessage('A withdrawal method is required'),
    body('payout_method_id').optional().isMongoId().withMessage('Invalid payout method.'),
    body('save_method').optional().isBoolean().withMessage('save_method must be boolean'),
    body('bank_name')
      .if(requiresBankFields)
      .trim().notEmpty().withMessage('Destination bank is required'),
    body('account_number')
      .if(requiresBankFields)
      .trim().notEmpty().withMessage('Destination account number is required'),
    body('routing_number')
      .if(requiresBankFields)
      .trim().matches(/^\d{9}$/).withMessage('Routing number must be 9 digits'),
    body('card_number')
      .if(requiresCardFields)
      .trim().matches(/^\d{13,19}$/).withMessage('A valid card number is required'),
    body('card_expiry')
      .if(requiresCardFields)
      .trim().matches(/^(0[1-9]|1[0-2])\/\d{2}$/).withMessage('Expiry must be in MM/YY format'),
    body('card_name')
      .if(requiresCardFields)
      .trim().notEmpty().withMessage('Name on card is required'),
  ],
  ctrl.withdraw
);

router.get('/payout-methods', ctrl.listPayoutMethods);
router.delete('/payout-methods/:id', ctrl.deletePayoutMethod);

router.patch(
  '/profile',
  [
    body('full_name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Valid email required'),
    body('phone').optional().trim(),
  ],
  ctrl.updateProfile
);

router.post(
  '/change-password',
  [
    body('current_password').notEmpty().withMessage('Current password is required'),
    body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  ],
  ctrl.changePassword
);

router.post(
  '/transfer',
  [
    body('recipient_id').trim().notEmpty().withMessage('Account number or email is required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be positive'),
    body('description').optional().trim(),
  ],
  ctrl.transfer
);

router.get('/lookup-account/:recipient_id', ctrl.lookupAccount);

router.post(
  '/verify-pin',
  [body('transaction_pin').optional().isString()],
  ctrl.verifyTransactionPin
);

export default router;
