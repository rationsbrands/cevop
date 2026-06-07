import { apiFetch } from '../lib/api';

export type ExpenseCategory =
  | 'RENT'
  | 'UTILITIES'
  | 'MAINTENANCE'
  | 'MARKETING'
  | 'SALARY_SUPPLEMENT'
  | 'EQUIPMENT'
  | 'SUPPLIES'
  | 'TRANSPORT'
  | 'INSURANCE'
  | 'PROFESSIONAL_FEES'
  | 'OTHER';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  MAINTENANCE: 'Maintenance',
  MARKETING: 'Marketing',
  SALARY_SUPPLEMENT: 'Salary Supplement',
  EQUIPMENT: 'Equipment',
  SUPPLIES: 'Supplies',
  TRANSPORT: 'Transport',
  INSURANCE: 'Insurance',
  PROFESSIONAL_FEES: 'Professional Fees',
  OTHER: 'Other',
};

export interface FinanceSummary {
  period: { from: string; to: string };
  revenue: number;
  tax: number;
  serviceCharge: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  wastage: number;
  labour: number;
  inventorySpend: number;
  otherExpenses: number;
  totalOpex: number;
  netProfit: number;
  netMargin: number;
  transactionCount: number;
  expenseCount: number;
  byMethod: { method: string; amount: number; count: number }[];
}

export interface CashFlowDay {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  running: number;
}

export interface PnLWeek {
  week: string;
  revenue: number;
  expenses: number;
  wastage: number;
  profit: number;
}

export interface Expense {
  id: string;
  organizationId: string;
  branchId?: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  description: string;
  date: string;
  isRecurring: boolean;
  recurringFrequency?: string;
  notes?: string;
  attachmentUrl?: string;
  recordedBy?: string;
  approvedBy?: string;
  createdAt: string;
  branch?: { id: string; name: string };
  recorder?: { id: string; name: string };
  approver?: { id: string; name: string };
}

const h = (token: string) => ({ token });
const p = (params: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;

export const getFinanceSummary = (
  token: string,
  params: { branchId?: string; from?: string; to?: string },
) =>
  apiFetch<{ success: boolean; data: FinanceSummary }>('/api/finance/summary', {
    ...h(token),
    params: p(params),
  });

export const getCashFlow = (
  token: string,
  params: { branchId?: string; from?: string; to?: string },
) =>
  apiFetch<{ success: boolean; data: CashFlowDay[] }>('/api/finance/cashflow', {
    ...h(token),
    params: p(params),
  });

export const getPnL = (token: string, params: { branchId?: string; from?: string; to?: string }) =>
  apiFetch<{ success: boolean; data: PnLWeek[] }>('/api/finance/pnl', {
    ...h(token),
    params: p(params),
  });

export const getExpenses = (
  token: string,
  params: { branchId?: string; from?: string; to?: string; category?: string },
) =>
  apiFetch<{ success: boolean; data: Expense[] }>('/api/finance/expenses', {
    ...h(token),
    params: p(params),
  });

export const createExpense = (token: string, body: Partial<Expense>) =>
  apiFetch<{ success: boolean; data: Expense }>('/api/finance/expenses', {
    ...h(token),
    method: 'POST',
    body,
  });

export const updateExpense = (token: string, id: string, body: Partial<Expense>) =>
  apiFetch<{ success: boolean; data: Expense }>(`/api/finance/expenses/${id}`, {
    ...h(token),
    method: 'PATCH',
    body,
  });

export const deleteExpense = (token: string, id: string) =>
  apiFetch<{ success: boolean }>(`/api/finance/expenses/${id}`, { ...h(token), method: 'DELETE' });
