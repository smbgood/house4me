import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { GoogleAuthService } from '../services/google-auth.service';

@Component({
  selector: 'app-google-auth',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="auth-shell">
      <div class="auth-card">
        <h1>Google authentication required</h1>
        <p *ngIf="loading">Redirecting to Google...</p>
        <p *ngIf="error" class="error">{{ error }}</p>
        <button *ngIf="error" type="button" (click)="retryAuth()">Try again</button>
      </div>
    </section>
  `,
  styles: [
    `
      .auth-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: #f8fafc;
      }

      .auth-card {
        max-width: 420px;
        padding: 24px;
        border-radius: 12px;
        background: #ffffff;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
        text-align: center;
      }

      .auth-card h1 {
        margin: 0 0 12px;
        font-size: 1.4rem;
      }

      .auth-card p {
        margin: 0;
        color: #334155;
      }

      .error {
        color: #b91c1c;
      }

      .auth-card button {
        margin-top: 16px;
        border: 0;
        border-radius: 8px;
        padding: 10px 14px;
        background: #2563eb;
        color: white;
        cursor: pointer;
      }
    `
  ]
})
export class GoogleAuthComponent implements OnInit {
  loading = true;
  error = '';
  private redirectTarget = '/';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly googleAuthService: GoogleAuthService
  ) {}

  async ngOnInit(): Promise<void> {
    const code = this.route.snapshot.queryParamMap.get('code');
    const state = this.route.snapshot.queryParamMap.get('state');
    const redirect = this.route.snapshot.queryParamMap.get('redirect');

    this.redirectTarget = state || redirect || '/';

    if (code) {
      await this.finishCallback(code, state || '/');
      return;
    }

    this.googleAuthService.initiateAuth(this.redirectTarget);
  }

  retryAuth(): void {
    this.loading = true;
    this.error = '';
    this.googleAuthService.initiateAuth(this.redirectTarget);
  }

  private async finishCallback(code: string, state: string): Promise<void> {
    try {
      await this.googleAuthService.handleCallback(code, state);
      await this.router.navigateByUrl(state || '/');
    } catch (error) {
      this.loading = false;
      this.error = error instanceof Error ? error.message : 'Failed to complete Google auth.';
    }
  }
}
