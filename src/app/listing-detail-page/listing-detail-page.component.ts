import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { RentalListing, RentalListingsService } from '../services/rental-listings.service';

@Component({
  selector: 'app-listing-detail-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './listing-detail-page.component.html',
  styleUrl: './listing-detail-page.component.css'
})
export class ListingDetailPageComponent implements OnInit {
  listing: RentalListing | null = null;
  loading = false;
  error = '';
  pendingLike = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly rentalListingsService: RentalListingsService
  ) {}

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = 'Listing ID is required.';
      return;
    }

    this.loading = true;
    this.error = '';
    try {
      const response = await this.rentalListingsService.getListing(id);
      this.listing = response.listing;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load listing.';
    } finally {
      this.loading = false;
    }
  }

  parseListingDetails(value: unknown): Array<{ category: string; parent_category: string; text: string[] }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const typed = entry as {
          category?: unknown;
          parent_category?: unknown;
          text?: unknown;
        };
        return {
          category: typeof typed.category === 'string' ? typed.category : 'Details',
          parent_category: typeof typed.parent_category === 'string' ? typed.parent_category : 'General',
          text: Array.isArray(typed.text) ? typed.text.filter((item): item is string => typeof item === 'string') : []
        };
      })
      .filter((entry): entry is { category: string; parent_category: string; text: string[] } => Boolean(entry));
  }

  getFeeEntries(value: unknown): string[] {
    if (!value || typeof value !== 'object') {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([key, fieldValue]) => `${key.replace(/_/g, ' ')}: ${String(fieldValue)}`)
      .filter((entry) => entry.trim().length > 0);
  }

  async toggleLike(): Promise<void> {
    if (!this.listing || this.pendingLike) {
      return;
    }

    this.pendingLike = true;
    this.error = '';
    try {
      const response = await this.rentalListingsService.likeListing(this.listing.id, !this.listing.is_liked);
      this.listing = {
        ...this.listing,
        is_liked: response.listing.is_liked
      };
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to update listing like.';
    } finally {
      this.pendingLike = false;
    }
  }
}
