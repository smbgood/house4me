export type ListingSource = 'zillow' | 'trulia' | 'forrent' | 'realtor';

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
  sourcePropertyId?: string;
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
  availableDate?: string;
  sqft?: number;
  descriptionText?: string;
  managementCompany?: string;
  landlordName?: string;
  photoCount?: number;
  tags?: string[];
  listingDetails?: unknown;
  fees?: unknown;
  popularity?: unknown;
  rawSnippet?: string;
  rawPayload?: unknown;
}

export interface SourceAdapter {
  source: ListingSource;
  fetchListings: (config: SearchConfig) => Promise<NormalizedListingInput[]>;
}
