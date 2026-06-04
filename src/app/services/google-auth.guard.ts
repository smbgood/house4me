import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { GoogleAuthService } from './google-auth.service';

interface VerifyGoogleTokenResponse {
  success: boolean;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthGuard implements CanActivate {
  constructor(
    private readonly googleAuthService: GoogleAuthService,
    private readonly http: HttpClient,
    private readonly router: Router
  ) {}

  async canActivate(_: object, state: RouterStateSnapshot): Promise<boolean | UrlTree> {
    const token = this.googleAuthService.getRefreshToken();
    if (!token) {
      return this.redirectToAuth(state.url);
    }

    try {
      const response = await firstValueFrom(
        this.http.get<VerifyGoogleTokenResponse>(`${environment.apiUrl}/verify-google-token`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      );
      if (response.success) {
        return true;
      }
    } catch {
      // no-op: handled by token clear + redirect below
    }

    this.googleAuthService.clearRefreshToken();
    return this.redirectToAuth(state.url);
  }

  private redirectToAuth(redirectUrl: string): UrlTree {
    return this.router.createUrlTree(['/google-auth'], {
      queryParams: { redirect: redirectUrl }
    });
  }
}
