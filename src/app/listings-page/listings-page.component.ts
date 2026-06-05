import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import {
  type CrossOffReason,
  type ListingFilters,
  type RentalListing,
  RentalListingsService
} from '../services/rental-listings.service';

type SelectBool = '' | 'true' | 'false';
type CrossOffReasonOption = { value: CrossOffReason; label: string };

@Component({
  selector: 'app-listings-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './listings-page.component.html',
  styleUrl: './listings-page.component.css'
})
export class ListingsPageComponent implements OnInit {
  listings: RentalListing[] = [];
  loading = false;
  error = '';
  pendingCrossOffIds = new Set<string>();
  pendingLikeIds = new Set<string>();
  crossOffModalListingId: string | null = null;
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

  source = '';
  pets: SelectBool = '';
  fence: SelectBool = '';
  minRent: number | null = null;
  maxRent: number | null = null;
  query = '';

  constructor(private readonly rentalListingsService: RentalListingsService) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async applyFilters(): Promise<void> {
    await this.load();
  }

  async clearFilters(): Promise<void> {
    this.source = '';
    this.pets = '';
    this.fence = '';
    this.minRent = null;
    this.maxRent = null;
    this.query = '';
    await this.load();
  }

  trackById(_: number, item: RentalListing): string {
    return item.id;
  }

  openCrossOffModal(id: string): void {
    if (this.pendingCrossOffIds.has(id)) {
      return;
    }
    this.crossOffModalListingId = id;
    this.selectedCrossOffReason = this.crossOffReasonOptions[0].value;
    this.crossOffModalError = '';
  }

  closeCrossOffModal(): void {
    this.crossOffModalListingId = null;
    this.selectedCrossOffReason = '';
    this.crossOffModalError = '';
  }

  closeCoLikeModal(): void {
    this.coLikeModalEmails = null;
  }

  async confirmCrossOffListing(): Promise<void> {
    const id = this.crossOffModalListingId;
    if (!id || this.pendingCrossOffIds.has(id)) {
      return;
    }
    if (!this.selectedCrossOffReason) {
      this.crossOffModalError = 'Please select a reason before crossing off.';
      return;
    }

    this.pendingCrossOffIds.add(id);
    this.error = '';
    this.crossOffModalError = '';
    try {
      await this.rentalListingsService.crossOffListing(id, this.selectedCrossOffReason);
      this.listings = this.listings.filter((listing) => listing.id !== id);
      this.closeCrossOffModal();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to cross off listing.';
    } finally {
      this.pendingCrossOffIds.delete(id);
    }
  }

  async toggleLikeListing(id: string, isLiked: boolean): Promise<void> {
    if (this.pendingLikeIds.has(id)) {
      return;
    }

    this.pendingLikeIds.add(id);
    this.error = '';
    try {
      const response = await this.rentalListingsService.likeListing(id, !isLiked);
      if (response.listing.is_liked) {
        this.listings = this.listings.filter((listing) => listing.id !== id);
        if ((response.other_likers?.length ?? 0) > 0) {
          this.coLikeModalEmails = response.other_likers ?? null;
        }
      } else {
        this.listings = this.listings.map((listing) =>
          listing.id === id ? { ...listing, is_liked: response.listing.is_liked } : listing
        );
      }
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
      const filters: ListingFilters = {
        source: this.source || undefined,
        pets: this.pets,
        fence: this.fence,
        minRent: this.minRent,
        maxRent: this.maxRent,
        q: this.query.trim() || undefined
      };
      const response = await this.rentalListingsService.getListings(filters);
      this.listings = response.listings;      
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load listings.';
    } finally {
      this.loading = false;
    }
  }
}
