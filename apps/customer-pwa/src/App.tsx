import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MenuPage } from './pages/MenuPage';
import { OrderStatusPage } from './pages/OrderStatusPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route path="/menu/:orgId/:tableId" element={<MenuPage />} />
      <Route path="/order/:orderId"       element={<OrderStatusPage />} />
      <Route path="/"                     element={<Navigate to="/menu/demo/table1" replace />} />
      <Route path="*"                     element={<NotFoundPage />} />
    </Routes>
  );
}
