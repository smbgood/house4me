import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

import { RentalListing, RentalListingsService } from '../services/rental-listings.service';

@Component({
  selector: 'app-liked-listings-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './liked-listings-page.component.html',
  styleUrl: './liked-listings-page.component.css'
})
export class LikedListingsPageComponent implements OnInit {
  listings: RentalListing[] = [];
  loading = false;
  error = '';
  pendingLikeIds = new Set<string>();

  constructor(private readonly rentalListingsService: RentalListingsService) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  trackById(_: number, item: RentalListing): string {
    return item.id;
  }

  formatListingSources(listing: RentalListing): string {
    const sourceValues =
      Array.isArray(listing.sources) && listing.sources.length > 0 ? listing.sources : [listing.source];
    return sourceValues
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => this.toSourceLabel(value))
      .join(', ');
  }

  async toggleLikeListing(id: string): Promise<void> {
    if (this.pendingLikeIds.has(id)) {
      return;
    }

    this.pendingLikeIds.add(id);
    this.error = '';
    try {
      await this.rentalListingsService.likeListing(id, false);
      this.listings = this.listings.filter((listing) => listing.id !== id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to update listing like.';
    } finally {
      this.pendingLikeIds.delete(id);
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const response = await this.rentalListingsService.getLikedListings();
      this.listings = response.listings;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load liked listings.';
    } finally {
      this.loading = false;
    }
  }

  private toSourceLabel(source: string): string {
    const normalized = source.trim().toLowerCase();
    if (normalized === 'realtor') {
      return 'Realtor.com';
    }
    if (normalized === 'forrent') {
      return 'ForRent';
    }
    return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
