import React, { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useApi } from '../context/auth';
import { useSocket } from '../context/socket';
import { showToast } from '../components/Popup';

function formatTime(isoString: string) {
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  stationId: string | null;
  quantity: number;
  notes: string | null;
  status: 'PENDING' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED' | 'PAID';
  menuItem: { name: string };
}

interface Order {
  id: string;
  status: string;
  table?: { label: string; number: number };
  createdAt: string;
  items: OrderItem[];
}

export function KDSPage() {
  const { activeBranchFilter } = useAuth();
  const api = useApi();
  const { socket, syncSignal } = useSocket();
  const queryClient = useQueryClient();

  const [selectedStationId, setSelectedStationId] = useState<string>('');

  // 1. Fetch Stations
  const { data: stations = [] } = useQuery({
    queryKey: ['kds-stations', activeBranchFilter, api.effectiveBranchId],
    queryFn: async () => {
      if (!api.effectiveBranchId) return [];
      const res = await api.get(`/api/stations?branchId=${api.effectiveBranchId}`);
      return res.success ? res.data : [];
    },
    enabled: !!api.effectiveBranchId,
  });

  // Auto-select first station if none selected
  useEffect(() => {
    if (stations.length > 0 && !selectedStationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedStationId(stations[0].id);
    }
  }, [stations, selectedStationId]);

  // 2. Fetch Orders for Station
  const { data: orders = [], refetch } = useQuery<Order[]>({
    queryKey: ['kds-orders', activeBranchFilter, api.effectiveBranchId, selectedStationId],
    queryFn: async () => {
      if (!api.effectiveBranchId || !selectedStationId) return [];
      const res = await api.get(
        `/api/orders?status=RECEIVED&status=PREPARING&limit=200&stationId=${selectedStationId}`,
      );
      return res.success ? res.data : [];
    },
    enabled: !!api.effectiveBranchId && !!selectedStationId,
    refetchInterval: 15_000, // 15s fallback — kitchen needs to be fast
  });

  // Refetch on socket reconnect (catches missed events during disconnect) + syncSignal
  useEffect(() => {
    refetch();
  }, [syncSignal, refetch]);

  useEffect(() => {
    if (!socket) return;
    const handleReconnect = () => refetch();
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('connect', handleReconnect);
    };
  }, [socket, refetch]);

  // Transform Orders into a flat list of Items for this station
  const stationItems = useMemo(() => {
    if (!selectedStationId) return [];

    const items: Array<{ order: Order; item: OrderItem }> = [];
    orders.forEach((o) => {
      o.items.forEach((i) => {
        if (
          i.stationId === selectedStationId &&
          i.status !== 'CANCELLED' &&
          i.status !== 'SERVED' &&
          i.status !== 'READY'
        ) {
          items.push({ order: o, item: i });
        }
      });
    });

    // Sort by order creation time (oldest first)
    items.sort(
      (a, b) => new Date(a.order.createdAt).getTime() - new Date(b.order.createdAt).getTime(),
    );
    return items;
  }, [orders, selectedStationId]);

  // Group by status
  const pendingItems = stationItems.filter((x) => x.item.status === 'PENDING');
  const preparingItems = stationItems.filter((x) => x.item.status === 'PREPARING');

  const [bumping, setBumping] = useState<string | null>(null);

  const handleBumpStatus = async (itemId: string, newStatus: string) => {
    setBumping(itemId);
    try {
      const { success } = await api.patch(`/api/order-items/${itemId}/status`, {
        status: newStatus,
      });
      if (success) {
        queryClient.invalidateQueries({ queryKey: ['kds-orders'] });
      } else {
        showToast('Failed to update item status', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setBumping(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-hidden">
      {/* Header */}
      <header className="flex-none flex items-center justify-between p-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight text-white">KDS</h1>
          <select
            value={selectedStationId}
            onChange={(e) => setSelectedStationId(e.target.value)}
            className="bg-gray-800 border-gray-700 text-white rounded px-3 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="" disabled>
              Select Station
            </option>
            {stations.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="text-gray-400 font-mono text-sm">{stationItems.length} active items</div>
      </header>

      {/* Board */}
      <main className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {/* PENDING COLUMN */}
        <section className="flex-1 min-w-[300px] flex flex-col bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
          <div className="p-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
            <h2 className="font-bold text-gray-200">INCOMING</h2>
            <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingItems.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {pendingItems.map(({ order, item }) => (
              <div
                key={item.id}
                className="bg-gray-800 rounded border border-gray-700 p-3 shadow-sm hover:border-gray-600 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="font-mono text-sm text-gray-400">
                    {formatTime(order.createdAt)}
                  </div>
                  <div className="font-bold text-lg text-[var(--accent)]">
                    {order.table?.label || 'Takeaway'}
                  </div>
                </div>
                <div className="text-xl font-bold mb-1">
                  {item.quantity}x {item.menuItem.name}
                </div>
                {item.notes && (
                  <div className="text-yellow-400 text-sm italic mb-3 bg-yellow-400/10 p-2 rounded">
                    "{item.notes}"
                  </div>
                )}
                <button
                  disabled={bumping === item.id}
                  onClick={() => handleBumpStatus(item.id, 'PREPARING')}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold rounded shadow transition-colors disabled:opacity-50"
                >
                  {bumping === item.id ? '...' : 'START PREPARING'}
                </button>
              </div>
            ))}
            {pendingItems.length === 0 && (
              <div className="text-center text-gray-500 py-10 font-medium">No incoming items</div>
            )}
          </div>
        </section>

        {/* PREPARING COLUMN */}
        <section className="flex-1 min-w-[300px] flex flex-col bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
          <div className="p-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
            <h2 className="font-bold text-gray-200">PREPARING</h2>
            <span className="bg-orange-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {preparingItems.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {preparingItems.map(({ order, item }) => (
              <div
                key={item.id}
                className="bg-gray-800 rounded border border-orange-500/30 p-3 shadow-sm hover:border-orange-500/60 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="font-mono text-sm text-gray-400">
                    {formatTime(order.createdAt)}
                  </div>
                  <div className="font-bold text-lg text-[var(--accent)]">
                    {order.table?.label || 'Takeaway'}
                  </div>
                </div>
                <div className="text-xl font-bold mb-1">
                  {item.quantity}x {item.menuItem.name}
                </div>
                {item.notes && (
                  <div className="text-yellow-400 text-sm italic mb-3 bg-yellow-400/10 p-2 rounded">
                    "{item.notes}"
                  </div>
                )}
                <button
                  disabled={bumping === item.id}
                  onClick={() => handleBumpStatus(item.id, 'READY')}
                  className="w-full py-3 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold rounded shadow transition-colors disabled:opacity-50 text-lg"
                >
                  {bumping === item.id ? '...' : 'BUMP TO READY'}
                </button>
              </div>
            ))}
            {preparingItems.length === 0 && (
              <div className="text-center text-gray-500 py-10 font-medium">No items preparing</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
