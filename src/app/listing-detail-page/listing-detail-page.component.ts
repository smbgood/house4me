import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import {
  type CrossOffReason,
  RentalListing,
  RentalListingsService
} from '../services/rental-listings.service';

type CrossOffReasonOption = { value: CrossOffReason; label: string };

@Component({
  selector: 'app-listing-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './listing-detail-page.component.html',
  styleUrl: './listing-detail-page.component.css'
})
export class ListingDetailPageComponent implements OnInit {
  listing: RentalListing | null = null;
  loading = false;
  error = '';
  pendingLike = false;
  pendingCrossOff = false;
  showCrossOffModal = false;
  coLikeModalEmails: string[] | null = null;
  selectedCrossOffReason: CrossOffReason | '' = '';
  crossOffModalError = '';
  readonly crossOffReasonOptions: CrossOffReasonOption[] = [
    { value: 'did_not_match_requirements', label: 'Did Not Match Requirements' },
    { value: 'did_not_like_area', label: 'Did Not Like Area' },
    { value: 'did_not_like_house', label: 'Did Not Like House' },
    { value: 'no_fence', label: 'No Fence' },
    { value: 'two_story', label: 'Two Story' },
    { value: 'no_tub', label: 'No Tub' },
    { value: 'too_close_to_neighbors', label: 'Too Close to Neighbors' }
  ];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
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

  closeCoLikeModal(): void {
    this.coLikeModalEmails = null;
  }

  openCrossOffModal(): void {
    if (!this.listing || this.pendingCrossOff || this.listing.is_crossed_off) {
      return;
    }
    this.showCrossOffModal = true;
    this.selectedCrossOffReason = this.crossOffReasonOptions[0].value;
    this.crossOffModalError = '';
  }

  closeCrossOffModal(): void {
    this.showCrossOffModal = false;
    this.selectedCrossOffReason = '';
    this.crossOffModalError = '';
  }

  async confirmCrossOffListing(): Promise<void> {
    if (!this.listing || this.pendingCrossOff) {
      return;
    }
    if (!this.selectedCrossOffReason) {
      this.crossOffModalError = 'Please select a reason before crossing off.';
      return;
    }

    this.pendingCrossOff = true;
    this.error = '';
    this.crossOffModalError = '';
    try {
      await this.rentalListingsService.crossOffListing(this.listing.id, this.selectedCrossOffReason);
      this.closeCrossOffModal();
      await this.router.navigate(['/']);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to cross off listing.';
    } finally {
      this.pendingCrossOff = false;
    }
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
      if (response.listing.is_liked && (response.other_likers?.length ?? 0) > 0) {
        this.coLikeModalEmails = response.other_likers ?? null;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to update listing like.';
    } finally {
      this.pendingLike = false;
    }
  }
}
