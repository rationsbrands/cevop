const OFFLINE_QUEUE_KEY = 'cevop_offline_sync_queue';

export interface SyncItem {
  id: string;
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
  timestamp: number;
  retryCount: number;
}

export const syncManager = {
  async addToQueue(url: string, method: string, body: any, headers: Record<string, string>) {
    const item: SyncItem = {
      id: Math.random().toString(36).substring(7),
      url,
      method,
      body,
      headers,
      timestamp: Date.now(),
      retryCount: 0,
    };

    const queue = this.getQueue();
    queue.push(item);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));

    // Trigger a custom event for the UI to show "Syncing..."
    window.dispatchEvent(
      new CustomEvent('cevop-sync-status', { detail: { pending: queue.length } }),
    );
  },

  getQueue(): SyncItem[] {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  async processQueue(token: string) {
    const queue = this.getQueue();
    if (queue.length === 0) return;

    const remaining: SyncItem[] = [];
    let successCount = 0;

    for (const item of queue) {
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: {
            ...item.headers,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(item.body),
        });

        if (res.ok) {
          successCount++;
        } else if (res.status >= 400 && res.status < 500) {
          // Client error, don't retry (e.g. invalid data)
          console.warn('Sync item failed with client error, dropping:', item.url);
        } else {
          // Server error, retry later
          item.retryCount++;
          if (item.retryCount < 5) remaining.push(item);
        }
      } catch (_err) {
        item.retryCount++;
        if (item.retryCount < 5) remaining.push(item);
      }
    }

    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    window.dispatchEvent(
      new CustomEvent('cevop-sync-status', { detail: { pending: remaining.length } }),
    );

    return successCount;
  },
};
