import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/theme';
import { PasswordStrength } from '../components/PasswordStrength';

const API_BASE = import.meta.env.VITE_API_URL || '';

const TIMEZONES = [
  { value: 'Africa/Lagos', label: 'Africa/Lagos (WAT — Nigeria, Cameroon)' },
  { value: 'Africa/Nairobi', label: 'Africa/Nairobi (EAT — Kenya, Tanzania)' },
  { value: 'Africa/Accra', label: 'Africa/Accra (GMT — Ghana)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST — South Africa)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST — UK)' },
  { value: 'America/New_York', label: 'America/New_York (EST — US East)' },
];
const CURRENCIES = [
  { value: 'NGN', label: 'NGN — Nigerian Naira (₦)' },
  { value: 'GHS', label: 'GHS — Ghanaian Cedi (₵)' },
  { value: 'KES', label: 'KES — Kenyan Shilling (KSh)' },
  { value: 'ZAR', label: 'ZAR — South African Rand (R)' },
  { value: 'USD', label: 'USD — US Dollar ($)' },
  { value: 'GBP', label: 'GBP — British Pound (£)' },
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

type Step = 'org' | 'account' | 'done';

export function SignupPage() {
  const { mode, setMode } = useTheme();
  const [step, setStep] = useState<Step>('org');

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  // Org step
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [currency, setCurrency] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCurrency = params.get('currency');
    const valid = ['NGN', 'GBP', 'GHS', 'KES', 'ZAR', 'USD', 'EUR'];
    return valid.includes(urlCurrency ?? '') ? urlCurrency! : 'NGN';
  });

  const [timezone, setTimezone] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTimezone = params.get('timezone');
    if (urlTimezone) return decodeURIComponent(urlTimezone);
    const currencyParam = params.get('currency');
    return currencyParam === 'GBP' ? 'Europe/London' : 'Africa/Lagos';
  });
  const [contactPhone, setContactPhone] = useState('');

  // Slug check
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Account step
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [orgStepError, setOrgStepError] = useState('');

  // Debounced slug check
  useEffect(() => {
    if (slugTimer.current) clearTimeout(slugTimer.current);
    if (!orgSlug || orgSlug.length < 2) {
      const t = window.setTimeout(() => setSlugStatus('idle'), 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setSlugStatus('checking'), 0);
    slugTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/check-slug/${orgSlug}`);
        const { available } = await res.json();
        setSlugStatus(available ? 'available' : 'taken');
      } catch {
        setSlugStatus('idle');
      }
    }, 500);
    return () => {
      window.clearTimeout(t);
      if (slugTimer.current) clearTimeout(slugTimer.current);
    };
  }, [orgSlug]);

  function handleOrgContinue(e: React.FormEvent) {
    e.preventDefault();
    setOrgStepError('');
    if (slugStatus === 'taken') {
      setOrgStepError('That slug is already taken. Please choose another.');
      return;
    }
    if (slugStatus === 'checking') {
      setOrgStepError('Still checking slug availability, please wait…');
      return;
    }
    setStep('account');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgName,
          orgSlug,
          adminName,
          adminEmail,
          adminPassword: password,
          contactPhone,
          timezone,
          currency,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Registration failed');
        return;
      }

      // Log them in immediately with returned cookie

      setStep('done');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const slugBorderColor =
    slugStatus === 'available'
      ? 'border-green-500'
      : slugStatus === 'taken'
        ? 'border-red-500'
        : slugStatus === 'checking'
          ? 'border-yellow-500'
          : '';

  if (step === 'done')
    return (
      <div className="auth-shell min-h-dvh w-full bg-[var(--bg)] grid lg:grid-cols-2 relative">
        <button
          onClick={() => setMode(nextThemeMode)}
          className={`absolute top-6 right-6 z-10 w-10 h-10 rounded-full border flex items-center justify-center transition-colors text-[10px] font-bold tracking-widest ${
            mode === 'system'
              ? 'bg-[var(--surface2)] border-[var(--border)] text-[var(--text)] shadow-sm'
              : mode === 'dark'
                ? 'bg-black border-[var(--border)] text-[var(--text)] shadow-sm'
                : 'bg-white border-[var(--border)] text-black shadow-sm'
          }`}
          title={`Theme: ${themeLabel} (click → ${nextThemeLabel})`}
          aria-label={`Theme ${themeLabel}. Click to switch to ${nextThemeLabel}.`}
        >
          {themeLabel}
        </button>

        <div className="hidden lg:flex flex-col justify-between p-10 border-r border-[var(--border)] bg-[var(--surface)]">
          <div className="space-y-3">
            <div className="brand-mark text-4xl text-[var(--accent)] leading-none">CEVOP</div>
            <p className="text-sm text-[var(--muted)] max-w-sm">
              Please verify your email to access your new dashboard and configure your restaurant.
            </p>
          </div>
          <div className="text-xs text-[var(--muted)] font-medium">
            Powered by <span className="brand-mark text-[var(--text)]">CEVOP</span>
          </div>
        </div>

        <div className="flex items-center justify-center p-6">
          <div className="w-full max-w-md space-y-6 animate-in text-center">
            <div className="w-16 h-16 bg-blue-500/20 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
            </div>

            <div className="space-y-2">
              <h1 className="font-display text-3xl text-[var(--text)]">Check your email</h1>
              <p className="text-sm text-[var(--muted)]">
                Welcome {adminName}! We've sent a verification link to <strong>{adminEmail}</strong>
                .
              </p>
            </div>

            <div className="card p-6 mt-4">
              <p className="text-sm text-[var(--text)]">
                Please click the link in the email to verify your address and log in to your
                dashboard.
              </p>
            </div>

            <button
              onClick={() => (window.location.href = '/login')}
              className="btn btn-secondary w-full py-3 tracking-widest text-sm mt-4"
            >
              Return to Login
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="auth-shell min-h-dvh w-full bg-[var(--bg)] grid lg:grid-cols-2 relative">
      <button
        onClick={() => setMode(nextThemeMode)}
        className={`absolute top-6 right-6 z-10 w-10 h-10 rounded-full border flex items-center justify-center transition-colors text-[10px] font-bold tracking-widest ${
          mode === 'system'
            ? 'bg-[var(--surface2)] border-[var(--border)] text-[var(--text)] shadow-sm'
            : mode === 'dark'
              ? 'bg-black border-[var(--border)] text-[var(--text)] shadow-sm'
              : 'bg-white border-[var(--border)] text-black shadow-sm'
        }`}
        title={`Theme: ${themeLabel} (click → ${nextThemeLabel})`}
        aria-label={`Theme ${themeLabel}. Click to switch to ${nextThemeLabel}.`}
      >
        {themeLabel}
      </button>

      <div className="hidden lg:flex flex-col justify-between p-10 border-r border-[var(--border)] bg-[var(--surface)]">
        <div className="space-y-3">
          <div className="brand-mark text-4xl text-[var(--accent)] leading-none">CEVOP</div>
          <p className="text-sm text-[var(--muted)] max-w-sm">
            Start your free trial and set up your restaurant’s workflow.
          </p>
        </div>
        <div className="space-y-3 max-w-md">
          <div className="card p-4">
            <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
              Setup
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)]">
              Branches, tables, menu and staff.
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
              Service
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)]">
              Orders, waiter calls and service requests.
            </div>
          </div>
        </div>
        <div className="text-xs text-[var(--muted)] font-medium">
          Powered by <span className="brand-mark text-[var(--text)]">CEVOP</span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8 animate-in">
          <div className="space-y-2">
            <div className="brand-mark text-5xl text-[var(--accent)] leading-none lg:hidden">
              CEVOP
            </div>
            <h1 className="font-display text-3xl text-[var(--text)]">Start free trial</h1>
            <p className="text-sm text-[var(--muted)]">No credit card needed.</p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {(['org', 'account'] as Step[]).map((s, i) => (
              <React.Fragment key={s}>
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${step === s || (step === 'account' && s === 'org') ? 'bg-[var(--accent)] border-[var(--accent)] text-black' : 'border-[var(--border)] text-[var(--muted)]'}`}
                >
                  {step === 'account' && s === 'org' ? <span>&#10003;</span> : <>{i + 1}</>}
                </div>
                {i < 1 && (
                  <div
                    className={`flex-1 h-0.5 transition-all ${step === 'account' ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
                  />
                )}
              </React.Fragment>
            ))}
            <span className="text-xs text-[var(--muted)] ml-2">
              {step === 'org' ? 'Your restaurant' : 'Your account'}
            </span>
          </div>

          {/* Step 1: Org details */}
          {step === 'org' && (
            <form onSubmit={handleOrgContinue} className="card p-6 space-y-4">
              <div>
                <label htmlFor="signup_org_name">Restaurant Name *</label>
                <input
                  id="signup_org_name"
                  name="orgName"
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    setOrgSlug(slugify(e.target.value));
                  }}
                  placeholder="e.g. Cevop Restaurant"
                  required
                />
              </div>

              <div>
                <label htmlFor="signup_org_slug">
                  URL Slug *
                  <span className="ml-2 text-[var(--muted)] normal-case font-normal text-xs">
                    {slugStatus === 'checking' && (
                      <span className="text-[var(--muted)]">Checking...</span>
                    )}
                    {slugStatus === 'available' && (
                      <span className="text-[var(--success)]">Available</span>
                    )}
                    {slugStatus === 'taken' && (
                      <span className="text-[var(--danger)]">Already taken</span>
                    )}
                  </span>
                </label>
                <input
                  id="signup_org_slug"
                  name="orgSlug"
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  placeholder="e.g. cevop-restaurant"
                  required
                  pattern="^[a-z0-9-]{2,100}$"
                  className={slugBorderColor}
                />
                <p className="text-xs text-[var(--muted)] mt-1">
                  Used for your dashboard URL. Lowercase, numbers, hyphens only.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="signup_timezone">Timezone *</label>
                  <select
                    id="signup_timezone"
                    name="timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    {TIMEZONES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="signup_currency">Currency *</label>
                  <select
                    id="signup_currency"
                    name="currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="signup_contact_phone">
                  Phone Number{' '}
                  <span className="text-[var(--muted)] normal-case font-normal">(optional)</span>
                </label>
                <input
                  id="signup_contact_phone"
                  name="contactPhone"
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="e.g. +234 800 000 0000"
                  autoComplete="tel"
                />
              </div>

              {orgStepError && (
                <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">
                  {orgStepError}
                </div>
              )}

              <button type="submit" className="btn btn-primary w-full py-3 text-sm tracking-widest">
                CONTINUE →
              </button>
            </form>
          )}

          {/* Step 2: Account details */}
          {step === 'account' && (
            <form onSubmit={handleSubmit} className="card p-6 space-y-4">
              <div>
                <label htmlFor="signup_admin_name">Your Full Name *</label>
                <input
                  id="signup_admin_name"
                  name="name"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                  placeholder="e.g. Jane Doe"
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="signup_admin_email">Email Address *</label>
                <input
                  id="signup_admin_email"
                  name="email"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                  placeholder="e.g. name@restaurant.com"
                  autoComplete="email"
                />
                <p className="text-xs text-[var(--muted)] mt-1">This will be your login email.</p>
              </div>
              <div>
                <label htmlFor="signup_admin_password">Password *</label>
                <div className="relative">
                  <input
                    id="signup_admin_password"
                    name="password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="••••••••"
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-xs select-none"
                  >
                    {showPw ? 'hide' : 'show'}
                  </button>
                </div>
                <PasswordStrength password={password} />
              </div>
              <div>
                <label htmlFor="signup_admin_confirm_password">Confirm Password *</label>
                <div className="relative">
                  <input
                    id="signup_admin_confirm_password"
                    name="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-xs select-none"
                  >
                    {showConfirm ? 'hide' : 'show'}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('org')}
                  className="btn btn-secondary flex-1 py-3 text-sm"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary flex-1 py-3 text-sm tracking-widest disabled:opacity-50"
                >
                  {submitting ? 'CREATING…' : 'CREATE ACCOUNT'}
                </button>
              </div>

              <p className="text-xs text-[var(--muted)] text-center">
                By signing up you agree to our Terms of Service.
              </p>
            </form>
          )}

          <p className="text-center text-xs text-[var(--muted)]">
            Already have an account?{' '}
            <Link to="/login" className="text-[var(--accent)] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
