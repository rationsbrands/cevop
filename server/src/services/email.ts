import { Resend } from 'resend';
import { logger } from './logger';

const resend = new Resend(process.env.RESEND_API_KEY);

export const FROM_ADDRESS = process.env.EMAIL_FROM || 'Cevop <noreply@cevop.io>';

const baseEmailStyle = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background-color: #f5f5f5;
  padding: 40px 20px;
  color: #333;
`;

const cardStyle = `
  background-color: #ffffff;
  max-width: 500px;
  margin: 0 auto;
  border-radius: 8px;
  padding: 32px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
`;

const buttonStyle = `
  display: inline-block;
  background-color: #111;
  color: #fff;
  padding: 12px 24px;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 500;
  margin: 24px 0;
`;

const footerStyle = `
  color: #666;
  font-size: 14px;
  margin-top: 32px;
  border-top: 1px solid #eee;
  padding-top: 16px;
`;

export async function sendPasswordReset(
  to: string,
  resetUrl: string,
  orgName: string,
): Promise<void> {
  const html = `
    <div style="${baseEmailStyle}">
      <div style="${cardStyle}">
        <h2 style="margin-top: 0; color: #111;">Cevop</h2>
        <h1 style="font-size: 24px; margin-bottom: 16px;">Reset your password</h1>
        <p style="line-height: 1.5;">We received a request to reset the password for your Cevop account at <strong>${orgName}</strong>. Click the button below. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="${buttonStyle}">Reset password</a>
        <div style="${footerStyle}">
          If you didn't request this, you can safely ignore this email.
        </div>
      </div>
    </div>
  `;

  const text = `
Reset your password

We received a request to reset the password for your Cevop account at ${orgName}. 
Click the link below. This link expires in 1 hour.

${resetUrl}

If you didn't request this, you can safely ignore this email.
  `.trim();

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: 'Reset your Cevop password',
      html,
      text,
    });
  } catch (error) {
    logger.error('Failed to send password reset email', { to, error });
    throw error;
  }
}

function formatRole(role: string): string {
  const map: Record<string, string> = {
    SUPERADMIN: 'Superadmin',
    ADMIN: 'Admin',
    BRANCH_ADMIN: 'Branch Admin',
    SERVICE: 'Service Staff',
    WAITER: 'Waiter',
  };
  return map[role] || role;
}

export async function sendInvite(
  to: string,
  inviteUrl: string,
  orgName: string,
  branchName: string | null,
  role: string,
  invitedByName: string,
): Promise<void> {
  const roleFormatted = formatRole(role);
  const branchText = branchName
    ? ` You'll be part of the <strong>${branchName}</strong> branch.`
    : '';
  const branchTextPlain = branchName ? ` You'll be part of the ${branchName} branch.` : '';

  const html = `
    <div style="${baseEmailStyle}">
      <div style="${cardStyle}">
        <h2 style="margin-top: 0; color: #111;">Cevop</h2>
        <h1 style="font-size: 24px; margin-bottom: 16px;">You're invited to join ${orgName}</h1>
        <p style="line-height: 1.5;">
          ${invitedByName} has invited you to join ${orgName} on Cevop as a ${roleFormatted}.${branchText}
        </p>
        <p style="line-height: 1.5;">
          Click below to set your password and get started. This link expires in 72 hours.
        </p>
        <a href="${inviteUrl}" style="${buttonStyle}">Accept invitation</a>
        <div style="${footerStyle}">
          If you didn't request this, you can safely ignore this email.
        </div>
      </div>
    </div>
  `;

  const text = `
You're invited to join ${orgName}

${invitedByName} has invited you to join ${orgName} on Cevop as a ${roleFormatted}.${branchTextPlain}

Click the link below to set your password and get started. This link expires in 72 hours.

${inviteUrl}

If you didn't request this, you can safely ignore this email.
  `.trim();

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `You've been invited to join ${orgName} on Cevop`,
      html,
      text,
    });
  } catch (error) {
    logger.error('Failed to send invite email', { to, error });
    throw error;
  }
}

export async function sendVerificationEmail(
  to: string,
  verifyUrl: string,
  orgName: string,
): Promise<void> {
  const html = `
    <div style="${baseEmailStyle}">
      <div style="${cardStyle}">
        <h2 style="margin-top: 0; color: #111;">Cevop</h2>
        <h1 style="font-size: 24px; margin-bottom: 16px;">Verify your email</h1>
        <p style="line-height: 1.5;">Welcome to Cevop! You signed up as the admin for <strong>${orgName}</strong>.</p>
        <p style="line-height: 1.5;">Please verify your email address by clicking the button below.</p>
        <a href="${verifyUrl}" style="${buttonStyle}">Verify Email</a>
        <div style="${footerStyle}">
          If you didn't create an account, you can safely ignore this email.
        </div>
      </div>
    </div>
  `;

  const text = `
Verify your email

Welcome to Cevop! You signed up as the admin for ${orgName}.
Please verify your email address by clicking the link below:

${verifyUrl}

If you didn't create an account, you can safely ignore this email.
  `.trim();

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: 'Verify your Cevop account email',
      html,
      text,
    });
  } catch (error) {
    logger.error('Failed to send verification email', { to, error });
    throw error;
  }
}
