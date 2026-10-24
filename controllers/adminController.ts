import { Response, NextFunction } from 'express';
import User from '../models/User';
import Account from '../models/Account';
import Transaction from '../models/Transaction';
import Withdrawal from '../models/Withdrawal';
import AuditLog from '../models/AuditLog';
import Settings, { DEFAULT_MAINTENANCE_MESSAGE } from '../models/Settings';
import generateAccountNumber from '../utils/generateAccountNumber';
import generateTransactionHistory from '../utils/generateTransactionHistory';
import { AuthRequest } from '../middleware/protect';

// List all customers with search & filter
export const getUsers = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, status, active, page = '1', limit = '20' } = req.query as Record<string, string>;

    const query: any = { role: 'customer' };

    if (search) {
      query.$or = [
        { full_name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    if (status === 'verified') query.is_verified = true;
    if (status === 'unverified') query.is_verified = false;
    if (active === 'true') query.is_active = true;
    if (active === 'false') query.is_active = false;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query).sort({ created_at: -1 }).skip(skip).limit(limitNum),
    ]);

    const userIds = users.map((u) => u._id);
    const accounts = await Account.find({ user_id: { $in: userIds } });
    const accountMap: Record<string, any> = {};
    accounts.forEach((acc) => {
      accountMap[acc.user_id.toString()] = acc;
    });

    const usersWithAccounts = users.map((u) => ({
      ...u.toJSON(),
      account: accountMap[u._id!.toString()] || null,
    }));

    res.json({
      success: true,
      users: usersWithAccounts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Create a new customer account
export const createUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { full_name, email, phone, password, starting_balance = 0, currency = 'USD', transaction_pin } = req.body;

    const user = await User.create({
      full_name,
      email,
      phone,
      password,
      plain_password: password,
      transaction_pin: transaction_pin || undefined,
      role: 'customer',
      is_verified: false,
      created_by_admin: true,
    });

    const accountNumber = await generateAccountNumber();
    const account = await Account.create({
      user_id: user._id,
      account_number: accountNumber,
      balance: starting_balance,
      currency,
    });

    if (starting_balance > 0) {
      await generateTransactionHistory({
        accountId: account._id as any,
        finalBalance: starting_balance,
        adminId: req.user!._id as any,
      });
    }

    await AuditLog.create({
      admin_id: req.user!._id,
      action: 'CREATE_USER',
      target_user_id: user._id,
      details: { email, full_name, starting_balance, currency },
    });

    res.status(201).json({ success: true, user: user.toJSON(), account });
  } catch (error) {
    next(error);
  }
};

// Get full customer detail
export const getUserDetail = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // These three only depend on req.params.id, not on each other — run
    // them concurrently instead of paying for 3 sequential DB round-trips.
    const [user, account, withdrawals] = await Promise.all([
      User.findById(req.params.id).select(
        '+plain_password +transaction_pin +ssn +id_document +utility_bill +face_photo'
      ),
      Account.findOne({ user_id: req.params.id }),
      Withdrawal.find({ user_id: req.params.id }).sort({ created_at: -1 }).limit(50),
    ]);
    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    const transactions = await Transaction.find({ account_id: account?._id })
      .sort({ created_at: -1 })
      .limit(50);

    // toJSON strips sensitive fields, so re-attach them explicitly for the admin view.
    const userData = user.toJSON();
    userData.plain_password = user.plain_password;
    userData.transaction_pin = user.transaction_pin;
    userData.ssn = user.ssn;
    userData.id_type = user.id_type;
    userData.id_document = user.id_document;
    userData.utility_bill = user.utility_bill;
    userData.face_photo = user.face_photo;

    res.json({ success: true, user: userData, account, transactions, withdrawals });
  } catch (error) {
    next(error);
  }
};

// Update account balance
export const updateBalance = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { new_balance, reason } = req.body;

    if (new_balance === undefined || new_balance < 0) {
      res.status(400).json({ success: false, message: 'Valid balance is required.' });
      return;
    }
    if (!reason || !reason.trim()) {
      res.status(400).json({ success: false, message: 'Reason is required for balance adjustments.' });
      return;
    }

    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    const account = await Account.findOne({ user_id: user._id });
    if (!account) {
      res.status(404).json({ success: false, message: 'Account not found.' });
      return;
    }

    const oldBalance = account.balance;
    account.balance = new_balance;
    account.updated_at = new Date();
    await account.save();

    await Transaction.create({
      account_id: account._id,
      type: 'adjustment',
      amount: Math.abs(new_balance - oldBalance),
      balance_after: new_balance,
      description: `Admin Adjustment — ${reason}`,
      created_by: req.user!._id,
    });

    await AuditLog.create({
      admin_id: req.user!._id,
      action: 'UPDATE_BALANCE',
      target_user_id: user._id,
      details: { old_balance: oldBalance, new_balance, reason },
    });

    res.json({ success: true, account, message: 'Balance updated successfully.' });
  } catch (error) {
    next(error);
  }
};

// Toggle verification
export const toggleVerify = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    const wasVerified = user.is_verified;
    user.is_verified = !wasVerified;

    if (user.is_verified) {
      user.verified_at = new Date();
      user.verified_by = req.user!._id as any;
    } else {
      user.verified_at = null;
      user.verified_by = null;
    }

    await user.save({ validateBeforeSave: false });

    await AuditLog.create({
      admin_id: req.user!._id,
      action: user.is_verified ? 'VERIFY_ACCOUNT' : 'UNVERIFY_ACCOUNT',
      target_user_id: user._id,
      details: { previous: wasVerified, current: user.is_verified },
    });

    res.json({
      success: true,
      is_verified: user.is_verified,
      message: `Account ${user.is_verified ? 'verified' : 'unverified'} successfully.`,
    });
  } catch (error) {
    next(error);
  }
};

// Get the current global maintenance-mode state
export const getMaintenanceMode = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const settings = await Settings.getSingleton();
    res.json({
      success: true,
      maintenance_mode: settings.maintenance_mode,
      maintenance_message: settings.maintenance_message,
    });
  } catch (error) {
    next(error);
  }
};

// Enable/disable maintenance mode and/or update its customer-facing message.
// Both fields are optional and independent — this powers both the on/off
// switch and the message editor in the admin panel, which can be saved
// separately. This is a global switch/message, not per-customer.
export const setMaintenanceMode = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { enabled, message } = req.body;
    const changingEnabled = typeof enabled === 'boolean';
    const changingMessage = typeof message === 'string';

    const settings = await Settings.getSingleton();
    if (changingEnabled) settings.maintenance_mode = enabled;
    if (changingMessage) settings.maintenance_message = message.trim() || DEFAULT_MAINTENANCE_MESSAGE;
    settings.updated_at = new Date();
    settings.updated_by = req.user!._id as any;
    await settings.save();

    await AuditLog.create({
      admin_id: req.user!._id,
      action: changingEnabled
        ? (settings.maintenance_mode ? 'ENABLE_MAINTENANCE' : 'DISABLE_MAINTENANCE')
        : 'UPDATE_MAINTENANCE_MESSAGE',
      target_user_id: req.user!._id,
      details: { maintenance_mode: settings.maintenance_mode, maintenance_message: settings.maintenance_message },
    });

    res.json({
      success: true,
      maintenance_mode: settings.maintenance_mode,
      maintenance_message: settings.maintenance_message,
      message: changingEnabled
        ? `Maintenance mode ${settings.maintenance_mode ? 'enabled' : 'disabled'}.`
        : 'Maintenance message updated.',
    });
  } catch (error) {
    next(error);
  }
};

// Analytics for admin dashboard
export const getAnalytics = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // None of these 6 queries depend on each other's results — running them
    // sequentially was paying for 6 round-trips to the remote cluster on
    // every admin dashboard load instead of 1.
    const [totalUsers, verifiedUsers, activeUsers, balanceAgg, recentTransactions, recentAuditLogs] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'customer', is_verified: true }),
      User.countDocuments({ role: 'customer', is_active: true }),
      Account.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]),
      Transaction.find().sort({ created_at: -1 }).limit(10),
      AuditLog.find()
        .sort({ created_at: -1 })
        .limit(10)
        .populate('admin_id', 'full_name email')
        .populate('target_user_id', 'full_name email'),
    ]);
    const totalBalance = balanceAgg[0]?.total || 0;

    res.json({
      success: true,
      analytics: {
        total_users: totalUsers,
        verified_users: verifiedUsers,
        active_users: activeUsers,
        total_balance: totalBalance,
        recent_transactions: recentTransactions,
        recent_audit_logs: recentAuditLogs,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Add transaction to a customer's account
export const addTransaction = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { type, amount, description, date } = req.body;

    if (!['credit', 'debit'].includes(type)) {
      res.status(400).json({ success: false, message: 'Type must be credit or debit.' });
      return;
    }
    if (!amount || amount <= 0) {
      res.status(400).json({ success: false, message: 'Amount must be greater than 0.' });
      return;
    }

    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    const account = await Account.findOne({ user_id: user._id });
    if (!account) {
      res.status(404).json({ success: false, message: 'Account not found.' });
      return;
    }

    if (type === 'debit' && account.balance < amount) {
      res.status(400).json({ success: false, message: 'Insufficient balance for this debit.' });
      return;
    }

    const newBalance = type === 'credit' ? account.balance + amount : account.balance - amount;

    account.balance = newBalance;
    account.updated_at = new Date();
    await account.save();

    const transaction = await Transaction.create({
      account_id: account._id,
      type,
      amount,
      balance_after: newBalance,
      description: description || (type === 'credit' ? 'Credit' : 'Debit'),
      created_at: date ? new Date(date) : new Date(),
      created_by: req.user!._id,
    });

    await AuditLog.create({
      admin_id: req.user!._id,
      action: 'ADD_TRANSACTION',
      target_user_id: user._id,
      details: { type, amount, description, balance_after: newBalance },
    });

    res.status(201).json({ success: true, transaction, account, message: 'Transaction added successfully.' });
  } catch (error) {
    next(error);
  }
};

// Delete a customer and their account/transactions
export const deleteUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    const account = await Account.findOne({ user_id: user._id });

    if (account) {
      await Transaction.deleteMany({ account_id: account._id });
      await account.deleteOne();
    }

    await AuditLog.create({
      admin_id: req.user!._id,
      action: 'DELETE_USER',
      target_user_id: user._id,
      details: { email: user.email, full_name: user.full_name },
    });

    await user.deleteOne();

    res.json({ success: true, message: 'Customer deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// Set/update transaction PIN
export const setTransactionPin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { transaction_pin } = req.body;

    if (!transaction_pin || !/^\d{4}$/.test(transaction_pin)) {
      res.status(400).json({ success: false, message: 'Transaction PIN must be exactly 4 digits.' });
      return;
    }

    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    user.transaction_pin = transaction_pin;
    await user.save({ validateBeforeSave: false });

    await AuditLog.create({
      admin_id: req.user!._id,
      action: 'SET_TRANSACTION_PIN',
      target_user_id: user._id,
      details: { pin_set: true },
    });

    res.json({ success: true, message: 'Transaction PIN updated successfully.' });
  } catch (error) {
    next(error);
  }
};

// Deactivate/activate account
export const deactivateUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    user.is_active = !user.is_active;
    await user.save({ validateBeforeSave: false });

    await AuditLog.create({
      admin_id: req.user!._id,
      action: user.is_active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      target_user_id: user._id,
      details: { is_active: user.is_active },
    });

    res.json({
      success: true,
      is_active: user.is_active,
      message: `Account ${user.is_active ? 'activated' : 'deactivated'} successfully.`,
    });
  } catch (error) {
    next(error);
  }
};
