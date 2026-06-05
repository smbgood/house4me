import { forRentAdapter } from './forrent';
import { realtorAdapter } from './realtor';
import { truliaAdapter } from './trulia';
import { zillowAdapter } from './zillow';

export const sourceAdapters = [zillowAdapter, truliaAdapter, forRentAdapter, realtorAdapter];

export { type ListingSource, type NormalizedListingInput, type SearchConfig, type SourceAdapter } from './types';
