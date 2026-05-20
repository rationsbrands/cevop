import { logger } from './logger';
// Removed shared types since we use structural types below

function fmtPrice(value: number | string): string {
  return '₦' + Number(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function notificationsEnabled(plan?: string): { whatsapp: boolean; slack: boolean } {
  if (!plan || plan === 'free') return { whatsapp: false, slack: false };
  if (plan === 'starter') return { whatsapp: true, slack: false };
  return { whatsapp: true, slack: true }; // trial, growth, enterprise
}

async function sendWhatsApp(phoneNumber: string, message: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) { logger.warn('WhatsApp not configured'); return; }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phoneNumber.replace(/\D/g, ''), type: 'text', text: { body: message } }),
    });
    if (!res.ok) { const err = await res.text(); logger.error('WhatsApp failed', { err }); }
  } catch (err) { logger.error('WhatsApp error', { err }); }
}

async function sendSlack(webhookUrl: string, text: string, blocks?: object[]): Promise<void> {
  try {
    const body: Record<string, unknown> = { text };
    if (blocks) body.blocks = blocks;
    const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) logger.error('Slack failed', { status: res.status });
  } catch (err) { logger.error('Slack error', { err }); }
}

type OrderForNotification = {
  id: string;
  tableId: string;
  total: { toString(): string } | number | string;
  items: Array<{ quantity: number; menuItemId: string; notes?: string | null; menuItem?: { name: string } | null }>;
  table?: { label: string } | null;
};

export async function notifyNewOrder(order: OrderForNotification, whatsappNumber?: string, slackWebhook?: string, plan?: string): Promise<void> {
  const { whatsapp, slack } = notificationsEnabled(plan);
  const tableLabel = order.table?.label || `Table ${order.tableId}`;
  const itemsSummary = order.items.map(i => `  • ${i.quantity}x ${i.menuItem?.name || i.menuItemId}${i.notes ? ` (${i.notes})` : ''}`).join('\n');
  const msg = `🍽️ *NEW ORDER — ${tableLabel}*\n\n#${order.id.slice(-6).toUpperCase()}\n\n${itemsSummary}\n\nTotal: ${fmtPrice(Number(order.total))}`;
  if (whatsapp && whatsappNumber) await sendWhatsApp(whatsappNumber, msg);
  if (slack && slackWebhook) await sendSlack(slackWebhook, `New order from ${tableLabel}`, [
    { type: 'header', text: { type: 'plain_text', text: `🍽️ New Order — ${tableLabel}` } },
    { type: 'section', fields: [{ type: 'mrkdwn', text: `*Order:*\n#${order.id.slice(-6).toUpperCase()}` }, { type: 'mrkdwn', text: `*Total:*\n${fmtPrice(Number(order.total))}` }] },
    { type: 'section', text: { type: 'mrkdwn', text: `*Items:*\n${itemsSummary}` } },
  ]);
}

type WaiterCallForNotification = {
  tableId: string;
  reason?: string | null;
  table?: { label: string } | null;
};

export async function notifyWaiterCall(call: WaiterCallForNotification, whatsappNumber?: string, slackWebhook?: string, plan?: string): Promise<void> {
  const { whatsapp, slack } = notificationsEnabled(plan);
  const tableLabel = call.table?.label || `Table ${call.tableId}`;
  const msg = `🔔 *WAITER CALLED — ${tableLabel}*\nReason: ${call.reason || 'No reason given'}`;
  if (whatsapp && whatsappNumber) await sendWhatsApp(whatsappNumber, msg);
  if (slack && slackWebhook) await sendSlack(slackWebhook, `Waiter called from ${tableLabel}`);
}

type ServiceRequestForNotification = {
  tableId: string;
  serviceType: string;
  notes?: string | null;
  table?: { label: string } | null;
};

export async function notifyServiceRequest(req: ServiceRequestForNotification, whatsappNumber?: string, slackWebhook?: string, plan?: string): Promise<void> {
  const { whatsapp, slack } = notificationsEnabled(plan);
  const tableLabel = req.table?.label || `Table ${req.tableId}`;
  const msg = `⚙️ *SERVICE REQUEST — ${tableLabel}*\nType: ${req.serviceType}\nNotes: ${req.notes || 'None'}`;
  if (whatsapp && whatsappNumber) await sendWhatsApp(whatsappNumber, msg);
  if (slack && slackWebhook) await sendSlack(slackWebhook, `Service request from ${tableLabel}`);
}
