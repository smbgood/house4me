import { Injectable } from '@angular/core';

import { environment } from '../../environments/environment';
import { GoogleAuthService } from './google-auth.service';

export interface RentalListing {
  id: string;
  source: string;
  source_listing_id?: string | null;
  source_property_id?: string | null;
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
  available_date?: string | null;
  sqft?: number | null;
  description_text?: string | null;
  management_company?: string | null;
  landlord_name?: string | null;
  photo_count?: number | null;
  tags?: string[] | null;
  listing_details?: unknown;
  fees?: unknown;
  popularity?: unknown;
  raw_snippet?: string | null;
  raw_payload?: unknown;
  is_crossed_off?: boolean;
  is_liked?: boolean;
  status: string;
  last_seen_at: string;
  created_at?: string;
  updated_at?: string;
  price_history?: PriceHistoryPoint[];
}

export interface PriceHistoryPoint {
  rent_price: number;
  captured_at: string;
}

export interface ListingFilters {
  list?: string;
  source?: string;
  pets?: 'true' | 'false' | '';
  fence?: 'true' | 'false' | '';
  minRent?: number | null;
  maxRent?: number | null;
  q?: string;
}

export interface ListingsResponse {
  listings: RentalListing[];
  selectedList?: ListingList;
}

export interface ListingResponse {
  listing: RentalListing;
}

export interface ListingCrossOffResponse {
  listing: {
    id: string;
    is_crossed_off: boolean;
    cross_off_reason: string | null;
    crossed_off_by: string | null;
    crossed_off_at: string | null;
  };
}

export type CrossOffReason =
  | 'did_not_match_requirements'
  | 'did_not_like_area'
  | 'did_not_like_house'
  | 'no_fence'
  | 'two_story'
  | 'no_tub'
  | 'too_close_to_neighbors';

export interface ListingLikeResponse {
  listing: {
    id: string;
    is_liked: boolean;
  };
  other_likers?: string[];
}

export interface ListingList {
  id: string;
  slug: string;
  name: string;
  is_system?: boolean;
  created_at?: string;
}

export interface ListingListsResponse {
  lists: ListingList[];
}

export interface CreateListingListResponse {
  list: ListingList;
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
    if (filters.list) {
      params.set('list', filters.list);
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

  async getListing(id: string): Promise<ListingResponse> {
    const params = new URLSearchParams({ id });
    const url = `${environment.apiUrl}/get-listing?${params.toString()}`;
    const refreshToken = this.googleAuthService.getRefreshToken();
    const headers: HeadersInit = refreshToken
      ? { Authorization: `Bearer ${refreshToken}` }
      : {};

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to load listing (${response.status}).`);
    }

    return (await response.json()) as ListingResponse;
  }

  async crossOffListing(id: string, crossOffReason: CrossOffReason): Promise<ListingCrossOffResponse> {
    const url = `${environment.apiUrl}/cross-off-listing`;
    const refreshToken = this.googleAuthService.getRefreshToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(refreshToken ? { Authorization: `Bearer ${refreshToken}` } : {})
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, isCrossedOff: true, crossOffReason })
    });
    if (!response.ok) {
      throw new Error(`Failed to cross off listing (${response.status}).`);
    }

    return (await response.json()) as ListingCrossOffResponse;
  }

  async likeListing(id: string, isLiked: boolean): Promise<ListingLikeResponse> {
    const url = `${environment.apiUrl}/like-listing`;
    const refreshToken = this.googleAuthService.getRefreshToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(refreshToken ? { Authorization: `Bearer ${refreshToken}` } : {})
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, isLiked })
    });
    if (!response.ok) {
      throw new Error(`Failed to update listing like (${response.status}).`);
    }

    return (await response.json()) as ListingLikeResponse;
  }

  async getLikedListings(): Promise<ListingsResponse> {
    const url = `${environment.apiUrl}/get-liked-listings`;
    const refreshToken = this.googleAuthService.getRefreshToken();
    const headers: HeadersInit = refreshToken
      ? { Authorization: `Bearer ${refreshToken}` }
      : {};

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to load liked listings (${response.status}).`);
    }

    return (await response.json()) as ListingsResponse;
  }

  async getListingLists(): Promise<ListingListsResponse> {
    const url = `${environment.apiUrl}/get-listing-lists`;
    const refreshToken = this.googleAuthService.getRefreshToken();
    const headers: HeadersInit = refreshToken
      ? { Authorization: `Bearer ${refreshToken}` }
      : {};

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to load listing lists (${response.status}).`);
    }

    return (await response.json()) as ListingListsResponse;
  }

  async createListingList(name: string): Promise<CreateListingListResponse> {
    const url = `${environment.apiUrl}/create-listing-list`;
    const refreshToken = this.googleAuthService.getRefreshToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(refreshToken ? { Authorization: `Bearer ${refreshToken}` } : {})
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name })
    });
    if (!response.ok) {
      throw new Error(`Failed to create listing list (${response.status}).`);
    }

    return (await response.json()) as CreateListingListResponse;
  }
}
