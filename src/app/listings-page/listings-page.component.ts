import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import {
  type ListingFilters,
  type RentalListing,
  RentalListingsService
} from '../services/rental-listings.service';

type SelectBool = '' | 'true' | 'false';

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
