import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Detect iOS Safari
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    if (isIOS && !isInStandaloneMode) {
      try {
        if (!localStorage.getItem('ios_hint_dismissed')) {
          setTimeout(() => setShowIOSHint(true), 4000);
        }
      } catch {
        void 0;
      }
    }
  }, [isIOS, isInStandaloneMode]);

  useEffect(() => {
    // Check if already installed
    const isInstalled =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isInstalled) return;

    // Check if user already dismissed
    try {
      if (localStorage.getItem('pwa_install_dismissed')) return;
    } catch {
      void 0;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show after a 3-second delay — don't interrupt on arrival
      setTimeout(() => setShow(true), 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    }
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    setShow(false);
    setDismissed(true);
    try {
      localStorage.setItem('pwa_install_dismissed', '1');
    } catch {
      void 0;
    }
  }

  if ((!show || dismissed) && !showIOSHint) return null;

  return (
    <>
      {show && !dismissed && (
        <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto">
          <div className="bg-[var(--surface)] border border-[var(--accent)] p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="text-2xl shrink-0">📱</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[var(--text)] mb-0.5">Add to Home Screen</p>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Install Cevop Admin for faster access — works like a native app, no app store
                  needed.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="flex-1 py-2 text-xs font-bold tracking-wider bg-[var(--accent)] text-black hover:brightness-110 transition-all"
              >
                Install
              </button>
              <button
                onClick={handleDismiss}
                className="px-4 py-2 text-xs text-[var(--muted)] border border-[var(--border)] hover:border-[var(--muted)] transition-all"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {showIOSHint && !isInStandaloneMode && (
        <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto">
          <div className="bg-[var(--surface)] border border-[var(--border)] p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="text-2xl shrink-0">📲</div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[var(--text)] mb-1">Add to Home Screen</p>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Tap the <strong className="text-[var(--text)]">Share</strong> button at the bottom
                  of Safari, then tap{' '}
                  <strong className="text-[var(--text)]">"Add to Home Screen"</strong>.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setShowIOSHint(false);
                try {
                  localStorage.setItem('ios_hint_dismissed', '1');
                } catch {
                  void 0;
                }
              }}
              className="mt-3 w-full py-2 text-xs text-[var(--muted)] border border-[var(--border)]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
