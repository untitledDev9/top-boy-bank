import { Router, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import protect, { AuthRequest } from '../middleware/protect';
import adminOnly from '../middleware/adminOnly';
import * as ctrl from '../controllers/adminController';
import Chat from '../models/Chat';
import AdminNotification from '../models/AdminNotification';
import AdminPushSubscription from '../models/AdminPushSubscription';
import { getVapidPublicKey } from '../utils/adminNotifications';
import { notifyAdmins } from '../utils/adminNotifications';

const router = Router();

router.use(protect, adminOnly);

router.post('/notifications/test', (req: AuthRequest, res: Response): void => {
  notifyAdmins({
    id: `test-${Date.now()}-${req.user!._id}`,
    type: 'message',
    title: 'Test notification',
    message: 'Live admin notifications are working.',
    url: '/sharp',
    created_at: new Date().toISOString(),
  });
  res.json({ success: true });
});

router.get('/notifications', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const requestedLimit = Number(req.query.limit) || 50;
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const records = await AdminNotification.find({ hidden_by: { $ne: req.user!._id } })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();
    const adminId = String(req.user!._id);

    res.json({
      success: true,
      notifications: records.map((record) => ({
        id: record.event_id,
        type: record.type,
        title: record.title,
        message: record.message,
        url: record.url,
        created_at: record.created_at.toISOString(),
        read: record.read_by.some((reader) => String(reader) === adminId),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/notifications/read-all', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await AdminNotification.updateMany({}, { $addToSet: { read_by: req.user!._id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.patch('/notifications/:id/read', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await AdminNotification.updateOne(
      { event_id: req.params.id },
      { $addToSet: { read_by: req.user!._id } }
    );
    if (!result.matchedCount) {
      res.status(404).json({ success: false, message: 'Notification not found.' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/notifications', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await AdminNotification.updateMany({}, { $addToSet: { hidden_by: req.user!._id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/notifications/vapid-public-key', (_req, res): void => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    res.status(503).json({ success: false, message: 'Push notifications are not configured on the server.' });
    return;
  }
  res.json({ success: true, publicKey });
});

router.post('/notifications/push-subscription', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { endpoint, keys } = req.body || {};
    if (
      typeof endpoint !== 'string' ||
      !endpoint.startsWith('https://') ||
      typeof keys?.p256dh !== 'string' ||
      !keys.p256dh ||
      typeof keys?.auth !== 'string' ||
      !keys.auth
    ) {
      res.status(400).json({ success: false, message: 'A valid push subscription is required.' });
      return;
    }
    if (!getVapidPublicKey()) {
      res.status(503).json({ success: false, message: 'Push notifications are not configured on the server.' });
      return;
    }

    await AdminPushSubscription.findOneAndUpdate(
      { admin_id: req.user!._id, endpoint },
      { $set: { keys } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/notifications/push-subscription', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      res.status(400).json({ success: false, message: 'Push subscription endpoint is required.' });
      return;
    }
    await AdminPushSubscription.deleteOne({ admin_id: req.user!._id, endpoint });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/users', ctrl.getUsers);

router.post(
  '/users',
  [
    body('full_name').trim().notEmpty().withMessage('Full name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('starting_balance').optional().isFloat({ min: 0 }),
    body('currency').optional().isLength({ min: 3, max: 3 }),
  ],
  ctrl.createUser
);

router.post(
  '/admins',
  [
    body('full_name').trim().notEmpty().isLength({ max: 100 }).withMessage('Full name is required and must be 100 characters or fewer'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  ctrl.createAdmin
);

router.get('/users/:id', ctrl.getUserDetail);

router.patch(
  '/users/:id/balance',
  [
    body('new_balance').isFloat({ min: 0 }).withMessage('Valid balance is required'),
    body('reason').trim().notEmpty().withMessage('Reason is required'),
  ],
  ctrl.updateBalance
);

router.post(
  '/users/:id/transactions',
  [
    body('type').isIn(['credit', 'debit']).withMessage('Type must be credit or debit'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
    body('description').optional().trim(),
    body('date').optional().isISO8601(),
  ],
  ctrl.addTransaction
);

router.patch(
  '/users/:id/pin',
  body('transaction_pin').matches(/^\d{4}$/).withMessage('PIN must be exactly 4 digits'),
  ctrl.setTransactionPin
);
router.patch('/users/:id/verify', ctrl.toggleVerify);
router.patch('/users/:id/deactivate', ctrl.deactivateUser);
router.delete('/users/:id', ctrl.deleteUser);
router.get('/analytics', ctrl.getAnalytics);

router.get('/maintenance', ctrl.getMaintenanceMode);
router.patch('/maintenance', [
  body('enabled').optional().isBoolean().withMessage('enabled must be a boolean'),
  body('message').optional().isString().isLength({ max: 500 }).withMessage('message must be 500 characters or fewer'),
], ctrl.setMaintenanceMode);

// ─── Admin Chat Endpoints ───

// GET /api/admin/chats — list active chats
router.get('/chats', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // This list is polled every second — project only the last message
    // instead of shipping full conversation histories over the wire on
    // every poll.
    const chats = await Chat.find({ status: { $ne: 'closed' } })
      .sort({ updated_at: -1 })
      .select('customer_name status admin_id updated_at messages')
      .slice('messages', -1)
      .lean();

    const chatList = chats.map((c) => ({
      _id: c._id,
      customer_name: c.customer_name,
      status: c.status,
      updated_at: c.updated_at,
      lastMessage: c.messages[c.messages.length - 1],
    }));

    res.json({ success: true, chats: chatList });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/chats/:id — get full chat
router.get('/chats/:id', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const chat = await Chat.findById(req.params.id).lean();
    if (!chat) {
      res.status(404).json({ success: false, message: 'Chat not found' });
      return;
    }
    res.json({ success: true, chat });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/chats/:id/takeover — admin takes over from AI
router.post('/chats/:id/takeover', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat || chat.status === 'closed') {
      res.status(404).json({ success: false, message: 'Chat not found' });
      return;
    }

    chat.status = 'admin';
    chat.admin_id = req.user!._id as any;
    chat.messages.push({
      sender: 'ai',
      text: 'You are now connected with a live support agent. How can we assist you?',
      created_at: new Date(),
    });
    await chat.save();

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/chats/:id/message — admin sends message
router.post('/chats/:id/message', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { text } = req.body;
    const chat = await Chat.findOne({ _id: req.params.id, status: 'admin' });
    if (!chat) {
      res.status(404).json({ success: false, message: 'Chat not found or not taken over' });
      return;
    }

    chat.messages.push({ sender: 'admin', text, created_at: new Date() });
    await chat.save();

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/chats/:id — end/delete chat
router.delete('/chats/:id', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await Chat.findByIdAndUpdate(req.params.id, { status: 'closed' });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
