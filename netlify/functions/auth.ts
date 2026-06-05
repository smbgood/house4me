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
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`
    }
  });
  if (!userInfoResponse.ok) {
    return { valid: false };
  }

  const userInfoData = (await userInfoResponse.json()) as GoogleUserInfoResponse;
  const email = userInfoData.email?.trim().toLowerCase();
  if (!email) {
    return { valid: false };
  }

  return {
    valid: true,
    email
  };
}
