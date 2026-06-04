export type ListingSource = 'zillow' | 'trulia' | 'forrent';

export interface SearchConfig {
  city: string;
  state: string;
  zip?: string;
  radiusMiles?: number;
  maxPrice?: number;
}

export interface NormalizedListingInput {
  source: ListingSource;
  sourceListingId?: string;
  listingUrl: string;
  imageUrl?: string;
  title?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  rentPrice?: number;
  bedrooms?: number;
  bathrooms?: number;
  allowsPets?: boolean | null;
  hasFence?: boolean | null;
  rawSnippet?: string;
  rawPayload?: unknown;
}

export interface SourceAdapter {
  source: ListingSource;
  fetchListings: (config: SearchConfig) => Promise<NormalizedListingInput[]>;
}
