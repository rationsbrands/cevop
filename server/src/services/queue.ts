import { Queue, Worker, Job } from 'bullmq';
import { logger } from './logger';
import {
  notifyNewOrder,
  notifyStaffWebPush,
  notifyWaiterCall,
  notifyServiceRequest,
} from './notifications';
import { sendInvite } from './email';
import { prisma } from './prisma';
import { io } from '../index';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const parsedUrl = new URL(REDIS_URL);
const isTLS = parsedUrl.protocol === 'rediss:';

const connection = {
  host: parsedUrl.hostname,
  port: parseInt(parsedUrl.port || '6379', 10),
  password: parsedUrl.password || undefined,
  username: parsedUrl.username || undefined,
  maxRetriesPerRequest: null,
  ...(isTLS && { tls: { rejectUnauthorized: false } }),
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

// 3. Escalation Queue — delayed jobs replace the setInterval polling
export const escalationQueue = new Queue('escalation', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  },
});

// 4. Escalation Worker
new Worker(
  'escalation',
  async (job: Job) => {
    const { type, id, organizationId, branchId } = job.data;

    try {
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
          return; // already resolved or acknowledged — skip

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
    } catch (err) {
      logger.error(`Escalation job failed`, { type, id, err });
    }
  },
  { connection, concurrency: 10 },
);

logger.info('BullMQ Notification Queue & Worker initialized');
logger.info('BullMQ Escalation Queue & Worker initialized');
