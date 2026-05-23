import React from 'react';

export function calculateStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (!password) return { score, label: '', color: 'bg-[var(--border)]' };

  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) return { score, label: 'Weak', color: 'bg-[var(--danger)]' };
  if (score === 2) return { score, label: 'Fair', color: 'bg-[var(--warning)]' };
  if (score === 3) return { score, label: 'Good', color: 'bg-[var(--info)]' };
  return { score, label: 'Strong', color: 'bg-[var(--success)]' };
}

export function PasswordStrength({ password }: { password?: string }) {
  if (!password) return null;
  const { score, label, color } = calculateStrength(password);

  return (
    <div className="space-y-1.5 mt-2">
      <div className="flex gap-1 h-1.5">
        <div
          className={`flex-1 rounded-full transition-colors ${score >= 1 ? color : 'bg-[var(--border)]'}`}
        />
        <div
          className={`flex-1 rounded-full transition-colors ${score >= 2 ? color : 'bg-[var(--border)]'}`}
        />
        <div
          className={`flex-1 rounded-full transition-colors ${score >= 3 ? color : 'bg-[var(--border)]'}`}
        />
        <div
          className={`flex-1 rounded-full transition-colors ${score >= 4 ? color : 'bg-[var(--border)]'}`}
        />
      </div>
      <p className="text-xs text-[var(--muted)] text-right font-medium">{label}</p>
    </div>
  );
}
