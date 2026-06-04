import { zillowAdapter } from './zillow';

export const sourceAdapters = [zillowAdapter];

export { type ListingSource, type NormalizedListingInput, type SearchConfig, type SourceAdapter } from './types';
