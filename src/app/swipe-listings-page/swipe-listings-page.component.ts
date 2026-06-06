import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

import { RentalListing, RentalListingsService } from '../services/rental-listings.service';

type SwipeDirection = 'left' | 'right';

@Component({
  selector: 'app-swipe-listings-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './swipe-listings-page.component.html',
  styleUrl: './swipe-listings-page.component.css'
})
export class SwipeListingsPageComponent implements OnInit {
  queue: RentalListing[] = [];
  loading = false;
  refetching = false;
  error = '';
  pendingAction = false;
  exhausted = false;
  coLikeModalEmails: string[] | null = null;
  dragOffsetX = 0;
  dragRotation = 0;
  activePointerId: number | null = null;
  pointerStartX = 0;
  exitDirection: SwipeDirection | null = null;
  readonly swipeThreshold = 100;

  constructor(private readonly rentalListingsService: RentalListingsService) {}

  get currentListing(): RentalListing | null {
    return this.queue[0] ?? null;
  }

  get cardTransform(): string {
    if (this.exitDirection === 'left') {
      return 'translateX(-140%) rotate(-20deg)';
    }
    if (this.exitDirection === 'right') {
      return 'translateX(140%) rotate(20deg)';
    }
    return `translateX(${this.dragOffsetX}px) rotate(${this.dragRotation}deg)`;
  }

  get showLikeOverlay(): boolean {
    return this.dragOffsetX > 30;
  }

  get showNopeOverlay(): boolean {
    return this.dragOffsetX < -30;
  }

  get sqftText(): string {
    const sqft = this.currentListing?.sqft;
    if (typeof sqft !== 'number' || !Number.isFinite(sqft) || sqft <= 0) {
      return '';
    }
    return `${Math.round(sqft).toLocaleString()} sq ft`;
  }

  get rentText(): string {
    const rent = this.currentListing?.rent_price;
    if (typeof rent !== 'number' || !Number.isFinite(rent)) {
      return 'Price unavailable';
    }
    return `$${Math.round(rent).toLocaleString()}`;
  }

  async ngOnInit(): Promise<void> {
    await this.loadListings(true);
  }

  async retry(): Promise<void> {
    await this.loadListings(this.queue.length === 0);
  }

  closeCoLikeModal(): void {
    this.coLikeModalEmails = null;
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.currentListing || this.pendingAction || this.exitDirection) {
      return;
    }
    this.activePointerId = event.pointerId;
    this.pointerStartX = event.clientX;
    this.dragOffsetX = 0;
    this.dragRotation = 0;
  }

  onPointerMove(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId || this.pendingAction || this.exitDirection) {
      return;
    }
    const deltaX = event.clientX - this.pointerStartX;
    this.dragOffsetX = deltaX;
    this.dragRotation = Math.max(-15, Math.min(15, deltaX / 18));
  }

  async onPointerUp(event: PointerEvent): Promise<void> {
    if (this.activePointerId !== event.pointerId) {
      return;
    }
    this.activePointerId = null;

    if (this.dragOffsetX >= this.swipeThreshold) {
      await this.decide('right');
      return;
    }
    if (this.dragOffsetX <= -this.swipeThreshold) {
      await this.decide('left');
      return;
    }

    this.dragOffsetX = 0;
    this.dragRotation = 0;
  }

  async passCurrentListing(): Promise<void> {
    await this.decide('left');
  }

  async likeCurrentListing(): Promise<void> {
    await this.decide('right');
  }

  @HostListener('window:keydown', ['$event'])
  async onKeydown(event: KeyboardEvent): Promise<void> {
    if (!this.currentListing || this.pendingAction || this.exitDirection) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      await this.passCurrentListing();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      await this.likeCurrentListing();
    }
  }

  private async decide(direction: SwipeDirection): Promise<void> {
    const listing = this.currentListing;
    if (!listing || this.pendingAction || this.exitDirection) {
      return;
    }

    this.pendingAction = true;
    this.error = '';
    this.exitDirection = direction;

    await this.wait(180);

    try {
      if (direction === 'left') {
        await this.rentalListingsService.crossOffListing({
          id: listing.id,
          reason: 'did_not_like_house'
        });
      } else {
        const response = await this.rentalListingsService.likeListing(listing.id, true);
        if ((response.other_likers?.length ?? 0) > 0) {
          this.coLikeModalEmails = response.other_likers ?? null;
        }
      }

      this.queue = this.queue.slice(1);
      this.dragOffsetX = 0;
      this.dragRotation = 0;
      this.exitDirection = null;

      if (this.queue.length === 0) {
        await this.loadListings(false);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to update listing.';
      this.dragOffsetX = 0;
      this.dragRotation = 0;
      this.exitDirection = null;
    } finally {
      this.pendingAction = false;
    }
  }

  private async loadListings(initialLoad: boolean): Promise<void> {
    if (initialLoad) {
      this.loading = true;
    } else {
      this.refetching = true;
    }
    this.error = '';

    try {
      const response = await this.rentalListingsService.getListings({ list: 'main' });
      this.queue = this.shuffle(response.listings ?? []);
      this.exhausted = this.queue.length === 0;
      this.dragOffsetX = 0;
      this.dragRotation = 0;
      this.exitDirection = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load listings.';
    } finally {
      this.loading = false;
      this.refetching = false;
    }
  }

  private shuffle(listings: RentalListing[]): RentalListing[] {
    const result = [...listings];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
