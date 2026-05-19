/**
 * Decode the exp claim from a JWT without verifying the signature.
 * Used client-side only to proactively schedule refresh before expiry.
 * Returns expiry as a Unix timestamp in milliseconds, or null if unparseable.
 */
export function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the token is already expired or will expire within
 * bufferMs milliseconds. Default buffer is 2 minutes.
 *
 * Used to decide whether to proactively refresh before making an API call,
 * and in the visibilitychange handler when a screen wakes from sleep.
 */
export function isTokenStale(token: string, bufferMs = 2 * 60 * 1000): boolean {
  const exp = getTokenExpiry(token);
  if (!exp) return true;
  return Date.now() >= exp - bufferMs;
}
