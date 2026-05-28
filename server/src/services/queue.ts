import { Queue, Worker, Job } from 'bullmq';
import { logger } from './logger';
import {
  notifyNewOrder,
  notifyStaffWebPush,
  notifyWaiterCall,
  notifyServiceRequest,
} from './notifications';
import { sendInvite } from './email';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = {
  host: new URL(REDIS_URL).hostname,
  port: parseInt(new URL(REDIS_URL).port || '6379', 10),
  password: new URL(REDIS_URL).password || undefined,
  username: new URL(REDIS_URL).username || undefined,
  maxRetriesPerRequest: null,
};

// 1. Notification Queue
export const notificationQueue = new Queue('notifications', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
  },
});

// 2. Worker to process notifications
new Worker(
  'notifications',
  async (job: Job) => {
    const { type, data } = job.data;

    try {
      switch (type) {
        case 'NEW_ORDER_NOTIFY':
          // Decoupled WhatsApp/Slack notifications
          await notifyNewOrder(
            data.order,
            data.whatsappNumber,
            data.slackWebhook,
            data.plan,
            data.currency,
            data.branchId,
            data.organizationId,
          );
          break;

        case 'STAFF_WEB_PUSH':
          // Decoupled Web Push
          await notifyStaffWebPush(data);
          break;

        case 'WAITER_CALL_NOTIFY':
          await notifyWaiterCall(
            data.call,
            data.whatsappNumber,
            data.slackWebhook,
            data.plan,
            data.branchId,
            data.organizationId,
          );
          break;

        case 'SERVICE_REQUEST_NOTIFY':
          await notifyServiceRequest(
            data.request,
            data.whatsappNumber,
            data.slackWebhook,
            data.plan,
            data.branchId,
            data.organizationId,
          );
          break;

        case 'EMAIL_INVITE':
          await sendInvite(
            data.email,
            data.inviteUrl,
            data.organizationName,
            data.branchName,
            data.role,
            data.inviterName,
          );
          break;

        default:
          logger.warn(`Unknown notification job type: ${type}`);
      }
    } catch (err) {
      logger.error(`Failed to process notification job ${job.id}`, { err });
      throw err; // BullMQ will retry based on attempts
    }
  },
  { connection, concurrency: 5 },
);

logger.info('BullMQ Notification Queue & Worker initialized');
