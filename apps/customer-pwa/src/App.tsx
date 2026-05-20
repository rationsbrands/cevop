import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
const MenuPage = React.lazy(() =>
  import('./pages/MenuPage').then((m) => ({ default: m.MenuPage })),
);
const OrderStatusPage = React.lazy(() =>
  import('./pages/OrderStatusPage').then((m) => ({ default: m.OrderStatusPage })),
);
const NotFoundPage = React.lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

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
        <Route path="/" element={<Navigate to="/menu/demo/table1" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </React.Suspense>
  );
}
