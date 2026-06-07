import { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../context/theme';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

type Step = 'code' | 'camera' | 'done';

interface KioskResult {
  name: string;
  role: string;
  isOnShift: boolean;
  timestamp: string;
  clockedInAt: string | null;
  durationMinutes: number | null;
}

/** Compress a video frame to a 320×320 JPEG (~15-25 KB). */
function captureFrame(videoEl: HTMLVideoElement): string {
  const SIZE = 320;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  // Crop to square from centre of video frame
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  ctx.drawImage(videoEl, sx, sy, side, side, 0, 0, SIZE, SIZE);

  return canvas.toDataURL('image/jpeg', 0.7);
}

export function KioskPage() {
  useTheme();

  const params = new URLSearchParams(window.location.search);
  const orgId = params.get('orgId') ?? '';
  const branchId = params.get('branchId') ?? '';

  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KioskResult | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [countdown, setCountdown] = useState(3);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus code input on mount / after reset
  useEffect(() => {
    if (step === 'code') inputRef.current?.focus();
  }, [step]);

  // Auto-reset after showing result for 5 seconds
  useEffect(() => {
    if (step !== 'done' || !result) return;
    const t = setTimeout(resetKiosk, 5000);
    return () => clearTimeout(t);
  }, [step, result]);

  // Clean up camera when step changes away from 'camera'
  useEffect(() => {
    if (step !== 'camera') stopCamera();
  }, [step]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      stopCamera();
    },
    [],
  );

  function resetKiosk() {
    stopCamera();
    setStep('code');
    setCode('');
    setError('');
    setCapturedPhoto(null);
    setResult(null);
    setCameraActive(false);
    setCameraError('');
    setCountdown(3);
  }

  function stopCamera() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  const startCamera = useCallback(async () => {
    setCameraError('');
    setCountdown(3);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      // 3-second countdown then auto-capture
      let count = 3;
      countdownRef.current = setInterval(() => {
        count -= 1;
        setCountdown(count);
        if (count <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          // Capture
          if (videoRef.current) {
            const photo = captureFrame(videoRef.current);
            setCapturedPhoto(photo);
          }
          stopCamera();
          void submitClockIn(true);
        }
      }, 1000);
    } catch (err: any) {
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Clocking in without photo.'
          : err?.name === 'NotFoundError'
            ? 'No camera found on this device. Clocking in without photo.'
            : 'Camera unavailable. Clocking in without photo.';
      setCameraError(msg);
      // Proceed without photo after brief pause
      setTimeout(() => void submitClockIn(false), 2000);
    }
  }, [code, orgId, branchId]);

  // Move to camera step after code is confirmed
  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || loading) return;
    setError('');
    setStep('camera');
    // Small delay so the screen transition renders before getUserMedia call
    setTimeout(() => void startCamera(), 150);
  }

  // Manual capture button (if user taps before countdown)
  function handleManualCapture() {
    if (!cameraActive || !videoRef.current) return;
    if (countdownRef.current) clearInterval(countdownRef.current);
    const photo = captureFrame(videoRef.current);
    setCapturedPhoto(photo);
    stopCamera();
    void submitClockIn(true, photo);
  }

  async function submitClockIn(hasPhoto: boolean, photoOverride?: string) {
    setLoading(true);
    const photoToSend = hasPhoto ? (photoOverride ?? capturedPhoto) : null;
    try {
      const body: Record<string, unknown> = {
        staffCode: code.trim().toUpperCase(),
        orgId,
        branchId,
      };
      if (photoToSend) body.photo = photoToSend;

      const res = await fetch(`${API_BASE}/api/shifts/kiosk-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
        setStep('done');
      } else {
        setError(data.error ?? 'Staff code not found');
        setStep('code');
        setCode('');
      }
    } catch {
      setError('Network error. Please try again.');
      setStep('code');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  const roleLabel: Record<string, string> = {
    WAITER: 'Waiter',
    KITCHEN: 'Kitchen',
    BAR: 'Bar',
    SERVICE: 'Service',
    CASHIER: 'Cashier',
    HOST: 'Host',
    BRANCH_ADMIN: 'Manager',
    ADMIN: 'Admin',
  };

  // ─── Not configured ────────────────────────────────────────────────────────
  if (!orgId || !branchId) {
    return (
      <div className="h-dvh flex items-center justify-center bg-[var(--bg)] p-8 text-center">
        <div className="space-y-3">
          <h1 className="font-display text-3xl text-[var(--danger)]">KIOSK NOT CONFIGURED</h1>
          <p className="text-[var(--muted)] text-sm">
            This kiosk URL is missing <code className="bg-[var(--surface2)] px-1">orgId</code> and{' '}
            <code className="bg-[var(--surface2)] px-1">branchId</code> parameters.
          </p>
          <p className="text-[var(--muted)] text-xs">Ask your manager to set up the kiosk URL.</p>
        </div>
      </div>
    );
  }

  // ─── Step: DONE (confirmation) ─────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-[var(--bg)] p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div
            className={`border-2 p-8 space-y-3 animate-in ${
              result.isOnShift
                ? 'border-[var(--ready)] bg-[var(--ready)]/5'
                : 'border-[var(--danger)] bg-[var(--danger)]/5'
            }`}
          >
            {/* Captured photo preview */}
            {capturedPhoto && (
              <div className="flex justify-center mb-2">
                <img
                  src={capturedPhoto}
                  alt="Clock-in selfie"
                  className="w-20 h-20 rounded-full object-cover border-4 border-[var(--surface2)]"
                />
              </div>
            )}

            <div
              className={`text-5xl font-display font-black ${
                result.isOnShift ? 'text-[var(--ready)]' : 'text-[var(--danger)]'
              }`}
            >
              {result.isOnShift ? 'CLOCKED IN' : 'CLOCKED OUT'}
            </div>
            <p className="text-2xl font-bold text-[var(--text)]">{result.name}</p>
            <p className="text-sm text-[var(--muted)]">{roleLabel[result.role] ?? result.role}</p>

            {/* Clock-in time */}
            <div className="text-sm space-y-1">
              {result.isOnShift ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[var(--muted)]">Clocked in at</span>
                  <span className="font-mono font-bold text-[var(--text)]">
                    {new Date(result.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ) : (
                <>
                  {result.clockedInAt && (
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-[var(--muted)]">Clocked in at</span>
                      <span className="font-mono font-bold text-[var(--text)]">
                        {new Date(result.clockedInAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[var(--muted)]">Clocked out at</span>
                    <span className="font-mono font-bold text-[var(--text)]">
                      {new Date(result.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {result.durationMinutes != null && (
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <span className="text-[var(--muted)]">Shift duration</span>
                      <span className="font-mono font-bold text-[var(--text)]">
                        {Math.floor(result.durationMinutes / 60)}h {result.durationMinutes % 60}m
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            <p className="text-[10px] text-[var(--muted)] pt-2">Returning to kiosk in 5 seconds…</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step: CAMERA ──────────────────────────────────────────────────────────
  if (step === 'camera') {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-black select-none">
        <div className="w-full max-w-sm flex flex-col items-center space-y-6 p-4">
          {/* Header */}
          <div className="text-center space-y-1">
            <h1 className="font-display text-2xl text-white tracking-tight">LOOK AT THE CAMERA</h1>
            <p className="text-white/50 text-sm">Taking your photo automatically…</p>
          </div>

          {/* Camera viewfinder */}
          <div className="relative w-72 h-72 bg-[#111] overflow-hidden">
            <video
              ref={videoRef}
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" // mirror for selfie feel
            />

            {/* Corner frame */}
            {cameraActive && (
              <>
                <span className="absolute top-3 left-3 w-8 h-8 border-t-4 border-l-4 border-[var(--accent)]" />
                <span className="absolute top-3 right-3 w-8 h-8 border-t-4 border-r-4 border-[var(--accent)]" />
                <span className="absolute bottom-3 left-3 w-8 h-8 border-b-4 border-l-4 border-[var(--accent)]" />
                <span className="absolute bottom-3 right-3 w-8 h-8 border-b-4 border-r-4 border-[var(--accent)]" />
              </>
            )}

            {/* Countdown overlay */}
            {cameraActive && countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-8xl font-display font-black text-white/90 drop-shadow-lg">
                  {countdown}
                </span>
              </div>
            )}

            {/* Loading spinner while camera starts */}
            {!cameraActive && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Camera error fallback */}
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#111] p-4">
                <p className="text-white/60 text-xs text-center leading-relaxed">{cameraError}</p>
              </div>
            )}
          </div>

          {/* Manual capture button */}
          {cameraActive && (
            <button
              onClick={handleManualCapture}
              className="w-16 h-16 rounded-full border-4 border-white bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center"
              aria-label="Capture now"
            >
              <span className="w-10 h-10 rounded-full bg-white" />
            </button>
          )}

          {/* Loading indicator after capture */}
          {loading && (
            <div className="flex items-center gap-2 text-white/60 text-sm">
              <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              Clocking in…
            </div>
          )}

          {/* Skip / cancel */}
          {!loading && (
            <button
              onClick={resetKiosk}
              className="text-white/30 text-xs hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Step: CODE ENTRY (default) ────────────────────────────────────────────
  return (
    <div className="h-dvh flex flex-col items-center justify-center bg-[var(--bg)] p-6 select-none">
      <div className="w-full max-w-sm space-y-8">
        {/* Title */}
        <div className="text-center space-y-1">
          <span
            className="cevop-wordmark cevop-wordmark-lg mx-auto block"
            role="img"
            aria-label="Cevop"
          />
          <h1 className="font-display text-4xl text-[var(--text)] tracking-tight mt-3">
            CLOCK IN / OUT
          </h1>
          <p className="text-[var(--muted)] text-sm">Enter your staff code to record attendance</p>
        </div>

        {/* Error */}
        {error && <p className="text-center text-sm text-[var(--danger)] font-medium">{error}</p>}

        {/* Code form */}
        <form onSubmit={handleCodeSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError('');
            }}
            placeholder="W-01"
            className="w-full bg-[var(--surface2)] border-2 border-[var(--border)] focus:border-[var(--accent)] text-[var(--text)] text-3xl font-display font-bold text-center px-4 py-5 outline-none tracking-[0.3em] uppercase transition-colors placeholder-[var(--muted)]/40"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />

          <button
            type="submit"
            disabled={!code.trim() || loading}
            className="w-full py-4 bg-[var(--accent)] text-black font-display font-black text-xl tracking-widest uppercase disabled:opacity-40 hover:brightness-110 active:scale-[0.98] transition-all"
          >
            CONFIRM
          </button>
        </form>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '0', '⌫'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key === '⌫') setCode((v) => v.slice(0, -1));
                else setCode((v) => (v + key).toUpperCase().slice(0, 10));
              }}
              className="py-4 border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] font-bold text-xl hover:bg-[var(--surface2)] hover:border-[var(--accent)] active:scale-95 transition-all font-mono"
            >
              {key}
            </button>
          ))}
        </div>

        {/* Letter prefix pad */}
        <div className="grid grid-cols-4 gap-2">
          {['W', 'K', 'B', 'S', 'M', 'T', 'H', 'C'].map((letter) => (
            <button
              key={letter}
              type="button"
              onClick={() => setCode((v) => (v + letter).slice(0, 10))}
              className="py-3 border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] font-bold text-sm hover:bg-[var(--surface2)] hover:text-[var(--text)] hover:border-[var(--accent)] active:scale-95 transition-all font-mono"
            >
              {letter}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
