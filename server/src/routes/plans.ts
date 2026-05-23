import { Router, Request, Response } from 'express';

export const plansRouter = Router();

// GET /api/plans — public pricing data for the marketing site
// No authentication required
plansRouter.get('/', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      plans: [
        {
          id: 'free',
          name: 'Free',
          description: 'Start exploring with no commitment.',
          prices: { NGN: 0, GBP: 0 },
          priceLabel: { NGN: 'Free forever', GBP: 'Free forever' },
          limits: {
            branches: 1,
            tables: 5,
            staff: 3,
            whatsapp: false,
            slack: false,
          },
          features: [
            '1 branch',
            'Up to 5 tables',
            'Up to 3 staff accounts',
            'QR menus & service display',
            'Waiter calls & service requests',
            'Live item availability updates',
            'Basic order flow (RECEIVED to SERVED)',
            '7-day analytics',
            'No credit card required',
          ],
          cta: 'Start Free',
          highlighted: false,
        },
        {
          id: 'starter',
          name: 'Starter',
          description: 'Everything a single location needs.',
          prices: { NGN: 18000, GBP: 29 },
          priceLabel: { NGN: '₦18,000/mo', GBP: '£29/mo' },
          limits: {
            branches: 1,
            tables: 25,
            staff: 10,
            whatsapp: true,
            slack: false,
          },
          features: [
            '1 branch',
            'Up to 25 tables',
            'Up to 10 staff accounts',
            'QR menus & service display',
            'Waiter calls, service requests & bill requests',
            'Floor sections & auto-assignment',
            '30-day analytics',
            'Cancel anytime',
          ],
          cta: 'Get Started',
          highlighted: false,
        },
        {
          id: 'growth',
          name: 'Growth',
          description: 'For restaurants expanding to multiple sites.',
          prices: { NGN: 45000, GBP: 79 },
          priceLabel: { NGN: '₦45,000/mo', GBP: '£79/mo' },
          limits: {
            branches: 5,
            tables: 100,
            staff: null,
            whatsapp: true,
            slack: true,
          },
          features: [
            'Up to 5 branches',
            'Up to 100 tables across all branches',
            'Unlimited staff accounts',
            'WhatsApp + Slack notifications',
            'Multi-branch dashboard',
            '1-year analytics',
            'Priority support',
            'Cancel anytime',
          ],
          cta: 'Get Started',
          highlighted: true,
        },
        {
          id: 'enterprise',
          name: 'Enterprise',
          description: 'Custom deployment for large groups.',
          prices: { NGN: null, GBP: null },
          priceLabel: { NGN: 'Custom', GBP: 'Custom' },
          limits: {
            branches: null,
            tables: null,
            staff: null,
            whatsapp: true,
            slack: true,
          },
          features: [
            'Unlimited branches and tables',
            'Unlimited staff accounts',
            'API access and integrations',
            'Custom onboarding and SLA',
            'Dedicated account manager',
            'Annual contract',
          ],
          cta: 'Contact Us',
          highlighted: false,
        },
      ],
      updatedAt: new Date().toISOString(),
    },
  });
});
