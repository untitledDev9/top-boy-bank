import { Server } from 'socket.io';
import webpush from 'web-push';
import AdminNotificationRecord from '../models/AdminNotification';
import type { AdminNotificationType } from '../models/AdminNotification';
import AdminPushSubscription from '../models/AdminPushSubscription';

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  title: string;
  message: string;
  url: string;
  created_at: string;
}

let io: Server | null = null;
let pushEnabled = false;

export function configureAdminNotifications(server: Server): void {
  io = server;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    console.warn('Background admin push is disabled: configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.');
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  pushEnabled = true;
}

export function getVapidPublicKey(): string | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  return publicKey && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT ? publicKey : null;
}

export function notifyAdmins(notification: AdminNotification): void {
  void dispatchAdminNotification(notification).catch((error: unknown) => {
    console.error('Failed to dispatch admin notification:', error);
  });
}

export async function dispatchAdminNotification(
  notification: AdminNotification,
  pushAdminId?: string
): Promise<{ pushSent: number; pushFailed: number }> {
  try {
    await AdminNotificationRecord.updateOne(
      { event_id: notification.id },
      {
        $setOnInsert: {
          event_id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          url: notification.url,
          created_at: notification.created_at,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('Failed to persist admin notification:', error);
  }

  io?.to('admins').emit('admin:notification', notification);

  if (!pushEnabled) return { pushSent: 0, pushFailed: 0 };
  return sendPushNotifications(notification, pushAdminId);
}

/*
 * Background push is best-effort; saving the event and live sockets still
 * deliver the in-app notification if a device's push service is unavailable.
 */
async function sendPushNotifications(
  notification: AdminNotification,
  adminId?: string
): Promise<{ pushSent: number; pushFailed: number }> {
  const query = adminId ? { admin_id: adminId } : {};
  const subscriptions = await AdminPushSubscription.find(query).lean();
  const results = await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        JSON.stringify({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: `${notification.title} in your admin dashboard.`,
          body: `${notification.title} in your admin dashboard.`,
          url: notification.url,
          created_at: notification.created_at,
        })
      );
      return 'sent' as const;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        try {
          await AdminPushSubscription.deleteOne({ _id: subscription._id });
        } catch (deleteError) {
          console.error('Failed to remove expired admin push subscription:', deleteError);
        }
        return 'failed' as const;
      }

      console.error('Failed to deliver an admin push notification:', error);
      return 'failed' as const;
    }
  }));
  return {
    pushSent: results.filter((result) => result === 'sent').length,
    pushFailed: results.filter((result) => result === 'failed').length,
  };
}
