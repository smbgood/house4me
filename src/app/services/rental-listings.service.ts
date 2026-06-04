import { Injectable } from '@angular/core';

import { environment } from '../../environments/environment';
import { GoogleAuthService } from './google-auth.service';

export interface RentalListing {
  id: string;
  source: string;
  listing_url: string;
  image_url: string | null;
  title: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rent_price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  allows_pets: boolean | null;
  has_fence: boolean | null;
  status: string;
  last_seen_at: string;
}

export interface ListingFilters {
  source?: string;
  pets?: 'true' | 'false' | '';
  fence?: 'true' | 'false' | '';
  minRent?: number | null;
  maxRent?: number | null;
  q?: string;
}

export interface ListingsResponse {
  listings: RentalListing[];
  syncStatus: Array<{
    source: string;
    status: string;
    completed_at: string | null;
    listings_found: number;
    listings_upserted: number;
    error_summary: string | null;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class RentalListingsService {
  constructor(private readonly googleAuthService: GoogleAuthService) {}

  async getListings(filters: ListingFilters): Promise<ListingsResponse> {
    const params = new URLSearchParams();

    if (filters.source) {
      params.set('source', filters.source);
    }
    if (filters.pets) {
      params.set('pets', filters.pets);
    }
    if (filters.fence) {
      params.set('fence', filters.fence);
    }
    if (filters.minRent !== null && filters.minRent !== undefined) {
      params.set('minRent', String(filters.minRent));
    }
    if (filters.maxRent !== null && filters.maxRent !== undefined) {
      params.set('maxRent', String(filters.maxRent));
    }
    if (filters.q) {
      params.set('q', filters.q);
    }

    const qs = params.toString();
    const url = `${environment.apiUrl}/get-listings${qs ? `?${qs}` : ''}`;
    const refreshToken = this.googleAuthService.getRefreshToken();
    const headers: HeadersInit = refreshToken
      ? { Authorization: `Bearer ${refreshToken}` }
      : {};

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to load listings (${response.status}).`);
    }

    return (await response.json()) as ListingsResponse;
  }
}
