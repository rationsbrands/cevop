import { logger } from './logger';
import { prisma } from './prisma';
import webpush from 'web-push';
// Removed shared types since we use structural types below

const CURRENCY_FORMAT: Record<string, { symbol: string; locale: string }> = {
  NGN: { symbol: '₦', locale: 'en-NG' },
  GBP: { symbol: '£', locale: 'en-GB' },
  EUR: { symbol: '€', locale: 'de-DE' },
  USD: { symbol: '$', locale: 'en-US' },
  Africa: { symbol: '$', locale: 'en-US' },
  GHS: { symbol: '₵', locale: 'en-GH' },
  KES: { symbol: 'KSh', locale: 'en-KE' },
  ZAR: { symbol: 'R', locale: 'en-ZA' },
};

function fmtPrice(value: number | string, currency?: string): string {
  const amount = Number(value);
  const fmt = CURRENCY_FORMAT[currency ?? 'NGN'] ?? CURRENCY_FORMAT.NGN;
  return (
    fmt.symbol +
    amount.toLocaleString(fmt.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function notificationsEnabled(plan?: string): { whatsapp: boolean; slack: boolean } {
  if (!plan || plan === 'free') return { whatsapp: false, slack: false };
  if (plan === 'starter') return { whatsapp: true, slack: false };
  return { whatsapp: true, slack: true }; // trial, growth, enterprise
}

type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

let webPushConfigured = false;

function ensureWebPushConfigured(): boolean {
  if (webPushConfigured) return true;
  const publicKey = (process.env.WEB_PUSH_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (
    process.env.WEB_PUSH_PRIVATE_KEY ||
    process.env.VAPID_PRIVATE_KEY ||
    ''
  ).trim();
  if (!publicKey || !privateKey) return false;
  const subject = (process.env.WEB_PUSH_SUBJECT || 'mailto:support@cevop.com').trim();
  webpush.setVapidDetails(subject, publicKey, privateKey);
  webPushConfigured = true;
  return true;
}

async function sendWebPushToEndpoints(
  endpoints: Array<{ endpoint: string; subscription: any }>,
  payload: WebPushPayload,
): Promise<void> {
  if (!ensureWebPushConfigured()) return;
  const body = JSON.stringify(payload);

  await Promise.all(
    endpoints.map(async ({ endpoint, subscription }) => {
      try {
        await webpush.sendNotification(subscription, body, {
          urgency: 'high', // Critical for instant "Pocket Alerts"
          TTL: 60 * 60, // 1 hour time-to-live
        });
      } catch (err: any) {
        const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : null;
        if (statusCode === 404 || statusCode === 410) {
          await (prisma as any).pushSubscription.deleteMany({ where: { endpoint } });
        } else {
          logger.warn('Web Push send failed', { statusCode, endpoint });
        }
      }
    }),
  );
}

export async function notifyStaffWebPush(params: {
  organizationId: string;
  branchId: string;
  roles: Array<'SERVICE' | 'WAITER' | 'KITCHEN'>;
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<void> {
  if (!ensureWebPushConfigured()) return;

  const users = await prisma.user.findMany({
    where: {
      organizationId: params.organizationId,
      branchId: params.branchId,
      isActive: true,
      isOnShift: true,
      role: { in: params.roles as any },
    },
    select: { id: true },
  });
  if (users.length === 0) return;

  const subs = await (prisma as any).pushSubscription.findMany({
    where: {
      organizationId: params.organizationId,
      branchId: params.branchId,
      app: 'service',
      userId: { in: users.map((u: any) => u.id) },
    },
    select: { endpoint: true, subscription: true },
  });

  if (!subs?.length) return;
  await sendWebPushToEndpoints(subs, {
    title: params.title,
    body: params.body,
    url: params.url,
    tag: params.tag,
  });
}

export async function notifyAdminWebPush(params: {
  organizationId: string;
  branchId: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<void> {
  if (!ensureWebPushConfigured()) return;

  // Find admin-app subscriptions for org-level admins and branch-scoped admins for this branch
  const subs = await (prisma as any).pushSubscription.findMany({
    where: {
      organizationId: params.organizationId,
      app: 'admin',
      OR: [
        { branchId: params.branchId },
        { branchId: null }, // org-wide admins receive all branch events
      ],
    },
    select: { endpoint: true, subscription: true },
  });

  if (!subs?.length) return;
  await sendWebPushToEndpoints(subs, {
    title: params.title,
    body: params.body,
    url: params.url,
    tag: params.tag,
  });
}

async function sendWhatsApp(phoneNumber: string, message: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    logger.warn('WhatsApp not configured');
    return;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phoneNumber.replace(/\D/g, ''),
        type: 'text',
        text: { body: message },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      logger.error('WhatsApp failed', { err });
    }
  } catch (err) {
    logger.error('WhatsApp error', { err });
  }
}

async function sendSlack(webhookUrl: string, text: string, blocks?: object[]): Promise<void> {
  try {
    const body: Record<string, unknown> = { text };
    if (blocks) body.blocks = blocks;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) logger.error('Slack failed', { status: res.status });
  } catch (err) {
    logger.error('Slack error', { err });
  }
}

type OrderForNotification = {
  id: string;
  tableId: string;
  total: { toString(): string } | number | string;
  items: Array<{
    quantity: number;
    menuItemId: string;
    notes?: string | null;
    menuItem?: { name: string } | null;
  }>;
  table?: { label: string } | null;
};

export async function notifyNewOrder(
  order: OrderForNotification,
  whatsappNumber?: string,
  slackWebhook?: string,
  plan?: string,
  currency?: string,
  branchId?: string,
  organizationId?: string,
): Promise<void> {
  const { whatsapp, slack } = notificationsEnabled(plan);
  const tableLabel = order.table?.label || `Table ${order.tableId}`;
  const itemsSummary = order.items
    .map(
      (i) =>
        `  • ${i.quantity}x ${i.menuItem?.name || i.menuItemId}${i.notes ? ` (${i.notes})` : ''}`,
    )
    .join('\n');
  const msg = `🍽️ *NEW ORDER — ${tableLabel}*\n\n#${order.id.slice(-6).toUpperCase()}\n\n${itemsSummary}\n\nTotal: ${fmtPrice(Number(order.total), currency)}`;

  // Web Push to all relevant staff
  if (organizationId && branchId) {
    await notifyStaffWebPush({
      organizationId,
      branchId,
      roles: ['WAITER', 'SERVICE', 'KITCHEN'],
      title: `New Order — ${tableLabel}`,
      body: itemsSummary,
      tag: `order-${order.id}`,
      url: '/',
    });
  }

  if (whatsapp && whatsappNumber) await sendWhatsApp(whatsappNumber, msg);
  if (slack && slackWebhook)
    await sendSlack(slackWebhook, `New order from ${tableLabel}`, [
      { type: 'header', text: { type: 'plain_text', text: `🍽️ New Order — ${tableLabel}` } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order:*\n#${order.id.slice(-6).toUpperCase()}` },
          { type: 'mrkdwn', text: `*Total:*\n${fmtPrice(Number(order.total), currency)}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Items:*\n${itemsSummary}` } },
    ]);
}

type WaiterCallForNotification = {
  id: string;
  tableId: string | null;
  reason?: string | null;
  table?: { label: string } | null;
};

export async function notifyWaiterCall(
  call: WaiterCallForNotification,
  whatsappNumber?: string,
  slackWebhook?: string,
  plan?: string,
  branchId?: string,
  organizationId?: string,
): Promise<void> {
  const { whatsapp, slack } = notificationsEnabled(plan);
  const tableLabel = call.table?.label || `Table ${call.tableId}`;
  const msg = `🔔 *WAITER CALLED — ${tableLabel}*\nReason: ${call.reason || 'No reason given'}`;

  // Web Push to all relevant staff
  if (organizationId && branchId) {
    await notifyStaffWebPush({
      organizationId,
      branchId,
      roles: ['WAITER', 'SERVICE'],
      title: `Waiter Call — ${tableLabel}`,
      body: call.reason || 'Assistance requested',
      tag: `waiter-call-${call.id}`,
      url: '/',
    });
  }

  if (whatsapp && whatsappNumber) await sendWhatsApp(whatsappNumber, msg);
  if (slack && slackWebhook) await sendSlack(slackWebhook, `Waiter called from ${tableLabel}`);
}

type ServiceRequestForNotification = {
  id: string;
  tableId: string | null;
  serviceType: string;
  notes?: string | null;
  table?: { label: string } | null;
};

export async function notifyServiceRequest(
  req: ServiceRequestForNotification,
  whatsappNumber?: string,
  slackWebhook?: string,
  plan?: string,
  branchId?: string,
  organizationId?: string,
): Promise<void> {
  const { whatsapp, slack } = notificationsEnabled(plan);
  const tableLabel = req.table?.label || `Table ${req.tableId}`;
  const msg = `⚙️ *SERVICE REQUEST — ${tableLabel}*\nType: ${req.serviceType}\nNotes: ${req.notes || 'None'}`;

  // Web Push to all relevant staff
  if (organizationId && branchId) {
    await notifyStaffWebPush({
      organizationId,
      branchId,
      roles: ['WAITER', 'SERVICE'],
      title: `Service Request — ${tableLabel}`,
      body: `${req.serviceType}${req.notes ? `: ${req.notes}` : ''}`,
      tag: `service-request-${req.id}`,
      url: '/',
    });
  }

  if (whatsapp && whatsappNumber) await sendWhatsApp(whatsappNumber, msg);
  if (slack && slackWebhook) await sendSlack(slackWebhook, `Service request from ${tableLabel}`);
}
