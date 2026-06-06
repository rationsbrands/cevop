import { formatPrice } from '../../../../shared/utils/currency';

export interface ReceiptData {
  organization: {
    name: string;
    currency: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  branch: {
    name: string;
    address?: string;
    phone?: string;
  };
  session: {
    id: string;
    table?: { label: string };
    assignedWaiter?: { name: string } | null;
    openedAt: string;
    closedAt?: string | null;
  };
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  totals: {
    subtotal?: number;
    taxAmount?: number;
    serviceChargeAmount?: number;
    grandTotal: number;
    amountPaid: number;
    balance: number;
  };
}

export function printReceipt(data: ReceiptData) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'absolute';
  iframe.style.top = '-9999px';
  iframe.style.width = '80mm';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  const { organization, branch, session, items, totals } = data;
  const curr = organization.currency || 'NGN';

  const dateStr = new Date(session.closedAt || session.openedAt || Date.now()).toLocaleString();

  const itemsHtml = items
    .map(
      (item) => `
    <tr>
      <td class="item-name">${item.quantity}x ${item.name}</td>
      <td class="amount">${formatPrice(item.lineTotal, curr)}</td>
    </tr>
  `,
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Receipt - ${session.id}</title>
        <style>
          @page {
            margin: 0;
            size: 80mm auto;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: 80mm;
            margin: 0;
            padding: 5mm;
            box-sizing: border-box;
            font-size: 12px;
            line-height: 1.2;
            color: #000;
            background: #fff;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .font-bold { font-weight: bold; }
          .title { font-size: 16px; margin-bottom: 5px; }
          .subtitle { font-size: 12px; margin-bottom: 3px; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; }
          td { vertical-align: top; padding: 2px 0; }
          .item-name { width: 70%; padding-right: 5px; word-break: break-word; }
          .amount { width: 30%; text-align: right; }
          .totals-table { margin-top: 8px; }
          .totals-table td { padding: 3px 0; }
          .footer { margin-top: 15px; font-size: 10px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title font-bold">${organization.name}</div>
          ${branch.name ? `<div class="subtitle">${branch.name}</div>` : ''}
          ${branch.address ? `<div class="subtitle">${branch.address}</div>` : ''}
          ${branch.phone ? `<div class="subtitle">Tel: ${branch.phone}</div>` : ''}
        </div>
        
        <div class="divider"></div>
        
        <div>
          <div>Order ID: ${session.id.slice(-8).toUpperCase()}</div>
          <div>Date: ${dateStr}</div>
          <div>Table: ${session.table?.label || 'Takeaway'}</div>
          ${session.assignedWaiter ? `<div>Server: ${session.assignedWaiter.name}</div>` : ''}
        </div>
        
        <div class="divider"></div>
        
        <table>
          ${itemsHtml}
        </table>
        
        <div class="divider"></div>
        
        <table class="totals-table">
          ${
            totals.subtotal != null
              ? `
          <tr>
            <td>Subtotal</td>
            <td class="text-right">${formatPrice(totals.subtotal, curr)}</td>
          </tr>`
              : ''
          }
          ${
            totals.taxAmount
              ? `
          <tr>
            <td>VAT / Tax</td>
            <td class="text-right">${formatPrice(totals.taxAmount, curr)}</td>
          </tr>`
              : ''
          }
          ${
            totals.serviceChargeAmount
              ? `
          <tr>
            <td>Service Charge</td>
            <td class="text-right">${formatPrice(totals.serviceChargeAmount, curr)}</td>
          </tr>`
              : ''
          }
          <tr>
            <td class="font-bold">Total</td>
            <td class="font-bold text-right">${formatPrice(totals.grandTotal, curr)}</td>
          </tr>
          <tr>
            <td>Amount Paid</td>
            <td class="text-right">${formatPrice(totals.amountPaid, curr)}</td>
          </tr>
          ${
            totals.balance > 0
              ? `
          <tr>
            <td class="font-bold">Balance Due</td>
            <td class="font-bold text-right">${formatPrice(totals.balance, curr)}</td>
          </tr>
          `
              : ''
          }
        </table>
        
        <div class="divider"></div>
        
        <div class="text-center footer">
          <div>Thank you for your visit!</div>
          <div>Powered by Cevop</div>
        </div>
      </body>
    </html>
  `;

  doc.open();
  doc.write(html);
  doc.close();

  // Wait a tiny bit for render, then print
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // Cleanup after print dialog closes
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  }, 250);
}
