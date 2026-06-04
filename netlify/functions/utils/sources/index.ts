import { forRentAdapter } from './forrent';
import { truliaAdapter } from './trulia';
import { zillowAdapter } from './zillow';

export const sourceAdapters = [zillowAdapter, truliaAdapter, forRentAdapter];

export { type ListingSource, type NormalizedListingInput, type SearchConfig, type SourceAdapter } from './types';
