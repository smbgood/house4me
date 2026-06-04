import { forRentAdapter } from './forrent';
import { zillowAdapter } from './zillow';

export const sourceAdapters = [zillowAdapter, forRentAdapter];

export { type ListingSource, type NormalizedListingInput, type SearchConfig, type SourceAdapter } from './types';
