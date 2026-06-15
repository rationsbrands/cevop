import { Queue, Worker, Job } from 'bullmq';
import { logger } from './logger';
import {
  notifyNewOrder,
  notifyStaffWebPush,
  notifyAdminWebPush,
  notifyWaiterCall,
  notifyServiceRequest,
} from './notifications';
import { sendInvite } from './email';
import { prisma } from './prisma';
import { io } from '../index';

// Background jobs require Redis. If REDIS_URL isn't configured (typical local dev),
// we skip BullMQ entirely and process notifications inline so the server doesn't
// spam reconnect errors against a Redis that isn't running.
const REDIS_URL = process.env.REDIS_URL;
const REDIS_ENABLED = !!REDIS_URL;

// ─── Notification processor (shared by BullMQ worker + inline fallback) ─────────

async function processNotificationJob(jobData: { type: string; data: any }): Promise<void> {
  const { type, data } = jobData;
  switch (type) {
    case 'NEW_ORDER_NOTIFY':
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
      await notifyStaffWebPush(data);
      break;
    case 'ADMIN_WEB_PUSH':
      await notifyAdminWebPush(data);
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
}

// ─── Escalation processor (shared by BullMQ worker) ─────────────────────────────

async function processEscalationJob(jobData: {
  type: string;
  id: string;
  organizationId: string;
  branchId: string;
}): Promise<void> {
  const { type, id, organizationId, branchId } = jobData;

  if (type === 'ESCALATE_ORDER') {
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        assignedWaiter: true,
        acknowledgedAt: true,
        escalationLevel: true,
        organizationId: true,
        branchId: true,
      },
    });
    if (
      !order ||
      order.status !== 'READY' ||
      order.acknowledgedAt !== null ||
      order.escalationLevel > 0
    )
      return;

    const updated = await prisma.order.update({
      where: { id },
      data: {
        assignedWaiter: null,
        assignedWaiterAt: null,
        escalationLevel: 1,
        lastEscalatedAt: new Date(),
      },
    });
    logger.warn('Order escalated to broadcast', { orderId: id, branchId });
    io.to(`${organizationId}:${branchId}`).emit('TASK_UNASSIGNED', {
      type: 'ORDER_READY',
      task: updated,
    });
    io.to(`${organizationId}:${branchId}`).emit('ORDER_UPDATED', updated);
  }

  if (type === 'ESCALATE_WAITER_CALL') {
    const call = await prisma.waiterCall.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        assignedTo: true,
        acknowledgedAt: true,
        escalationLevel: true,
        organizationId: true,
        branchId: true,
      },
    });
    if (
      !call ||
      call.status !== 'PENDING' ||
      call.acknowledgedAt !== null ||
      call.escalationLevel > 0
    )
      return;

    const updated = await prisma.waiterCall.update({
      where: { id },
      data: {
        assignedTo: null,
        assignedAt: null,
        escalationLevel: 1,
        lastEscalatedAt: new Date(),
      },
    });
    logger.warn('Waiter call escalated to broadcast', { callId: id, branchId });
    io.to(`${organizationId}:${branchId}`).emit('TASK_UNASSIGNED', {
      type: 'WAITER_CALL',
      task: updated,
    });
    io.to(`${organizationId}:${branchId}`).emit('WAITER_CALL_UPDATED', updated);
  }

  if (type === 'ESCALATE_SERVICE_REQUEST') {
    const request = await prisma.serviceRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        assignedTo: true,
        acknowledgedAt: true,
        escalationLevel: true,
        organizationId: true,
        branchId: true,
      },
    });
    if (
      !request ||
      request.status !== 'PENDING' ||
      request.acknowledgedAt !== null ||
      request.escalationLevel > 0
    )
      return;

    const updated = await prisma.serviceRequest.update({
      where: { id },
      data: {
        assignedTo: null,
        assignedAt: null,
        escalationLevel: 1,
        lastEscalatedAt: new Date(),
      },
    });
    logger.warn('Service request escalated to broadcast', { requestId: id, branchId });
    io.to(`${organizationId}:${branchId}`).emit('TASK_UNASSIGNED', {
      type: 'SERVICE_REQUEST',
      task: updated,
    });
    io.to(`${organizationId}:${branchId}`).emit('SERVICE_REQUEST_UPDATED', updated);
  }
}

// ─── Queue wiring ───────────────────────────────────────────────────────────────

// Minimal stub matching the bits of the Queue API we use (.add)
interface QueueLike {
  add: (name: string, data: any, opts?: any) => Promise<any>;
}

let notificationQueue: QueueLike;
let escalationQueue: QueueLike;

if (!REDIS_ENABLED) {
  // Inline fallback — no Redis. Notifications run fire-and-forget; delayed
  // escalation jobs are skipped (production nicety, not required locally).
  logger.warn('REDIS_URL not set — background queues disabled, processing notifications inline');
  notificationQueue = {
    add: async (_name, jobData) => {
      processNotificationJob(jobData).catch((err) =>
        logger.error('Inline notification failed', { err }),
      );
    },
  };
  escalationQueue = {
    add: async () => {
      /* no-op without Redis */
    },
  };
} else {
  const parsedUrl = new URL(REDIS_URL!);
  const isTLS = parsedUrl.protocol === 'rediss:';
  const connection = {
    host: parsedUrl.hostname,
    port: parseInt(parsedUrl.port || '6379', 10),
    password: parsedUrl.password || undefined,
    username: parsedUrl.username || undefined,
    maxRetriesPerRequest: null,
    ...(isTLS && { tls: { rejectUnauthorized: false } }),
  };

  notificationQueue = new Queue('notifications', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    },
  });

  new Worker(
    'notifications',
    async (job: Job) => {
      try {
        await processNotificationJob(job.data);
      } catch (err) {
        logger.error(`Failed to process notification job ${job.id}`, { err });
        throw err; // BullMQ retries based on attempts
      }
    },
    { connection, concurrency: 5 },
  );

  escalationQueue = new Queue('escalation', {
    connection,
    defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
  });

  new Worker(
    'escalation',
    async (job: Job) => {
      try {
        await processEscalationJob(job.data);
      } catch (err) {
        logger.error('Escalation job failed', { jobData: job.data, err });
      }
    },
    { connection, concurrency: 10 },
  );

  logger.info('BullMQ Notification & Escalation Queues initialized');
}

export { notificationQueue, escalationQueue };
