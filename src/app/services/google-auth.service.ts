import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

interface OAuthCallbackResponse {
  success: boolean;
  refreshToken?: string;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  private readonly storageKey = 'google_refresh_token';
  private readonly scopes = ['openid', 'email', 'profile'];

  constructor(private readonly http: HttpClient) {}

  initiateAuth(redirectUrl = '/'): void {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', environment.googleClientId);
    authUrl.searchParams.set('redirect_uri', environment.googleRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', this.scopes.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', redirectUrl);
    window.location.assign(authUrl.toString());
  }

  async handleCallback(code: string, state?: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.get<OAuthCallbackResponse>(
        `${environment.apiUrl}/oauth-callback?code=${encodeURIComponent(code)}${
          state ? `&state=${encodeURIComponent(state)}` : ''
        }`
      )
    );

    if (!response.success || !response.refreshToken) {
      throw new Error('Google OAuth callback did not return a refresh token.');
    }

    localStorage.setItem(this.storageKey, response.refreshToken);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.storageKey);
  }

  clearRefreshToken(): void {
    localStorage.removeItem(this.storageKey);
  }
}
