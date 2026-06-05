/**
 * Supabase Storage helper — uploads clock-in photos using the REST API.
 * No SDK needed; just fetch.
 *
 * Required env vars:
 *   SUPABASE_URL           e.g. https://xyzabc.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  the service_role secret from Project Settings → API
 *
 * Photos are stored in the 'clockin-photos' bucket under:
 *   {orgId}/{YYYY-MM}/{shiftId}.jpg
 *
 * Retention: delete photos older than 90 days via the cleanup endpoint
 * (POST /api/admin/cleanup-photos, called nightly by a Railway cron).
 */

import { logger } from './logger';

const BUCKET = 'clockin-photos';

function getStorageConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function ensureBucket(url: string, key: string): Promise<void> {
  // Check if bucket exists; create if not
  const listRes = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (listRes.status === 200) return; // already exists

  await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false, // private — only accessible via signed URL or service role
      fileSizeLimit: 102400, // 100KB max per photo
    }),
  });
}

/**
 * Upload a base64 JPEG to Supabase Storage.
 * Returns the storage path (not a full URL) so we can delete it later.
 * Returns null if storage is not configured or upload fails.
 */
export async function uploadClockInPhoto(
  base64DataUrl: string,
  orgId: string,
  shiftId: string,
): Promise<string | null> {
  const config = getStorageConfig();
  if (!config) return null; // storage not configured — skip silently

  try {
    // Decode base64 data URL: "data:image/jpeg;base64,/9j/4AAQ..."
    const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.length > 150_000) {
      logger.warn('Clock-in photo too large, skipping upload', { size: buffer.length, shiftId });
      return null;
    }

    await ensureBucket(config.url, config.key);

    const month = new Date().toISOString().slice(0, 7); // "2026-06"
    const path = `${orgId}/${month}/${shiftId}.jpg`;

    const uploadRes = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.key}`,
        apikey: config.key,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text().catch(() => '');
      logger.error('Clock-in photo upload failed', { status: uploadRes.status, err, shiftId });
      return null;
    }

    // Return the storage path — we use this to build signed URLs and for deletion
    return path;
  } catch (err) {
    logger.error('Clock-in photo upload exception', { err, shiftId });
    return null;
  }
}

/**
 * Generate a short-lived signed URL for viewing a clock-in photo.
 * Expires in 1 hour — just long enough for the timesheets page session.
 */
export async function getSignedPhotoUrl(path: string): Promise<string | null> {
  const config = getStorageConfig();
  if (!config || !path) return null;

  try {
    const res = await fetch(`${config.url}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.key}`,
        apikey: config.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { signedURL?: string };
    return data.signedURL ? `${config.url}/storage/v1${data.signedURL}` : null;
  } catch {
    return null;
  }
}

/**
 * Delete a photo from storage. Called by the cleanup job.
 */
export async function deleteClockInPhoto(path: string): Promise<boolean> {
  const config = getStorageConfig();
  if (!config || !path) return false;

  try {
    const res = await fetch(`${config.url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${config.key}`,
        apikey: config.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [path] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
