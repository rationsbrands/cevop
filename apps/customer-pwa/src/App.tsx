import React from 'react';
import { Routes, Route } from 'react-router-dom';
const MenuPage = React.lazy(() =>
  import('./pages/MenuPage').then((m) => ({ default: m.MenuPage })),
);
const OrderStatusPage = React.lazy(() =>
  import('./pages/OrderStatusPage').then((m) => ({ default: m.OrderStatusPage })),
);
const NotFoundPage = React.lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

function ScanPromptPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col items-center justify-center p-8 text-center">
      <div className="space-y-6 max-w-xs">
        <div className="w-20 h-20 mx-auto border-4 border-[var(--accent)] flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-[var(--accent)] opacity-60" />
        </div>
        <h1 className="font-display text-4xl text-[var(--text)] tracking-tight">SCAN TO ORDER</h1>
        <p className="text-[var(--muted)] text-sm leading-relaxed">
          Point your camera at the QR code on your table to view the menu and place your order.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]">
          <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <Routes>
        <Route path="/menu/:orgId/:tableId" element={<MenuPage />} />
        <Route path="/order/:orderId" element={<OrderStatusPage />} />
        <Route path="/" element={<ScanPromptPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </React.Suspense>
  );
}
