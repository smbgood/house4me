interface VerifiedGoogleToken {
  valid: boolean;
  email?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleUserInfoResponse {
  email?: string;
  email_verified?: boolean;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getAllowedEmails(): Set<string> {
  const csv = process.env['GOOGLE_AUTH_ALLOWED_EMAILS'] ?? '';
  return new Set(
    csv
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isAuthorizedEmail(email: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const allowedEmails = getAllowedEmails();
  const allowedDomain = (process.env['GOOGLE_AUTH_ALLOWED_DOMAIN'] ?? '').trim().toLowerCase();

  if (!allowedDomain && allowedEmails.size === 0) {
    return false;
  }

  if (allowedEmails.has(normalizedEmail)) {
    return true;
  }

  if (allowedDomain) {
    return normalizedEmail.endsWith(`@${allowedDomain}`);
  }

  return false;
}

export async function verifyGoogleRefreshToken(refreshToken: string): Promise<VerifiedGoogleToken> {
  if (!refreshToken) {
    return { valid: false };
  }

  const clientId = getRequiredEnv('GOOGLE_CLIENT_ID');
  const clientSecret = getRequiredEnv('GOOGLE_CLIENT_SECRET');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!tokenResponse.ok) {
    return { valid: false };
  }

  const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
  if (!tokenData.access_token) {
    return { valid: false };
  }

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`
    }
  });

  if (!profileResponse.ok) {
    return { valid: false };
  }

  const profile = (await profileResponse.json()) as GoogleUserInfoResponse;
  if (!profile.email || profile.email_verified !== true) {
    return { valid: false };
  }

  if (!isAuthorizedEmail(profile.email)) {
    return { valid: false };
  }

  return {
    valid: true,
    email: profile.email
  };
}
