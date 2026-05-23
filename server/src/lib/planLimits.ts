export const PLAN_LIMITS = {
  free: {
    branches: 1,
    tables: 5,
    staff: 3,
    whatsapp: false,
    slack: false,
  },
  trial: {
    branches: 5,
    tables: 100,
    staff: Infinity,
    whatsapp: true,
    slack: true,
  },
  starter: {
    branches: 1,
    tables: 25,
    staff: 10,
    whatsapp: true,
    slack: false,
  },
  growth: {
    branches: 5,
    tables: 100,
    staff: Infinity,
    whatsapp: true,
    slack: true,
  },
  enterprise: {
    branches: Infinity,
    tables: Infinity,
    staff: Infinity,
    whatsapp: true,
    slack: true,
  },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;

export function getLimits(plan: string) {
  return PLAN_LIMITS[plan as PlanName] ?? PLAN_LIMITS.free;
}

export function getUpgradeMessage(resource: 'tables' | 'branches' | 'staff', plan: string): string {
  const messages = {
    tables: {
      free: 'You have reached the 5 table limit on the free plan. Upgrade to Starter for up to 25 tables.',
      starter:
        'You have reached the 25 table limit on Starter. Upgrade to Growth for up to 100 tables.',
      trial: 'You have reached the table limit. Upgrade to Growth to continue.',
      growth: 'You have reached the 100 table limit. Contact us about Enterprise.',
      enterprise: 'Table limit reached. Contact support.',
    },
    branches: {
      free: 'The free plan supports 1 branch. Upgrade to Growth to add up to 5 branches.',
      starter: 'Starter supports 1 branch. Upgrade to Growth to add up to 5 branches.',
      trial: 'You have reached the branch limit. Upgrade to Growth to continue.',
      growth: 'You have reached the 5 branch limit. Contact us about Enterprise.',
      enterprise: 'Branch limit reached. Contact support.',
    },
    staff: {
      free: 'The free plan supports up to 3 staff accounts. Upgrade to Starter for up to 10.',
      starter: 'Starter supports up to 10 staff accounts. Upgrade to Growth for unlimited staff.',
      trial: 'You have reached the staff limit. Upgrade to Growth to continue.',
      growth: 'Staff limit reached.',
      enterprise: 'Staff limit reached. Contact support.',
    },
  };
  return messages[resource][plan as PlanName] ?? `Upgrade your plan to add more ${resource}.`;
}
