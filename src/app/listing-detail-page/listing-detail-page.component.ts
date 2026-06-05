import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import {
  type CrossOffReason,
  type ListingList,
  type ListingTransferOperation,
  type PriceHistoryPoint,
  RentalListing,
  RentalListingsService
} from '../services/rental-listings.service';

type CrossOffReasonOption = { value: CrossOffReason; label: string };
type PriceChartPoint = { x: number; y: number; rentPrice: number; capturedAt: string };

@Component({
  selector: 'app-listing-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './listing-detail-page.component.html',
  styleUrl: './listing-detail-page.component.css'
})
export class ListingDetailPageComponent implements OnInit {
  listing: RentalListing | null = null;
  priceHistory: PriceHistoryPoint[] = [];
  priceChartPoints: PriceChartPoint[] = [];
  priceHistoryPolyline = '';
  loading = false;
  error = '';
  pendingLike = false;
  pendingCrossOff = false;
  pendingTransfer = false;
  showCrossOffModal = false;
  showTransferModal = false;
  coLikeModalEmails: string[] | null = null;
  transferSuccessMessage = '';
  currentListSlug = 'main';
  transferOperation: ListingTransferOperation = 'copy';
  targetListSlug = '';
  transferModalError = '';
  loadingTransferLists = false;
  transferLists: ListingList[] = [];
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
  readonly chartWidth = 720;
  readonly chartHeight = 220;
  private readonly chartPadding = 22;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly rentalListingsService: RentalListingsService
  ) {}

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    const listSlug = this.route.snapshot.queryParamMap.get('list')?.trim().toLowerCase();
    if (listSlug) {
      this.currentListSlug = listSlug;
    }
    if (!id) {
      this.error = 'Listing ID is required.';
      return;
    }

    this.loading = true;
    this.error = '';
    try {
      const response = await this.rentalListingsService.getListing(id);
      this.listing = response.listing;
      this.setPriceHistory(response.listing.price_history ?? []);
      await this.loadTransferLists();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load listing.';
    } finally {
      this.loading = false;
    }
  }

  get canMoveFromCurrentList(): boolean {
    return this.currentListSlug !== 'main';
  }

  get filteredTransferTargetLists(): ListingList[] {
    return this.transferLists.filter(
      (list) => !list.is_system && list.slug !== 'main' && list.slug !== this.currentListSlug
    );
  }

  get canSubmitTransfer(): boolean {
    if (this.pendingTransfer || !this.listing || !this.targetListSlug) {
      return false;
    }
    if (this.transferOperation === 'move' && !this.canMoveFromCurrentList) {
      return false;
    }
    return true;
  }

  private setPriceHistory(history: PriceHistoryPoint[]): void {
    const normalized = this.normalizePriceHistory(history);
    this.priceHistory = normalized;
    this.priceChartPoints = this.buildPriceChartPoints(normalized);
    this.priceHistoryPolyline = this.priceChartPoints.map((point) => `${point.x},${point.y}`).join(' ');
  }

  private normalizePriceHistory(history: PriceHistoryPoint[]): PriceHistoryPoint[] {
    const normalized = history
      .filter((point) => Number.isFinite(point.rent_price) && typeof point.captured_at === 'string' && point.captured_at.length > 0)
      .map((point) => ({
        rent_price: Math.round(point.rent_price),
        captured_at: point.captured_at
      }));

    const collapsed: PriceHistoryPoint[] = [];
    for (const point of normalized) {
      const previous = collapsed[collapsed.length - 1];
      if (previous && previous.rent_price === point.rent_price) {
        continue;
      }
      collapsed.push(point);
    }
    return collapsed;
  }

  private buildPriceChartPoints(history: PriceHistoryPoint[]): PriceChartPoint[] {
    if (history.length === 0) {
      return [];
    }

    const prices = history.map((point) => point.rent_price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;
    const plotWidth = this.chartWidth - this.chartPadding * 2;
    const plotHeight = this.chartHeight - this.chartPadding * 2;

    if (history.length === 1) {
      return [
        {
          x: this.chartWidth / 2,
          y: this.chartHeight / 2,
          rentPrice: history[0].rent_price,
          capturedAt: history[0].captured_at
        }
      ];
    }

    return history.map((point, index) => {
      const x = this.chartPadding + (plotWidth * index) / (history.length - 1);
      const y =
        this.chartPadding +
        (priceRange === 0 ? plotHeight / 2 : ((maxPrice - point.rent_price) / priceRange) * plotHeight);
      return {
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        rentPrice: point.rent_price,
        capturedAt: point.captured_at
      };
    });
  }

  formatChartPrice(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  }

  formatChartDate(value: string): string {
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) {
      return value;
    }
    return asDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatListingSources(listing: RentalListing): string {
    const sourceValues =
      Array.isArray(listing.sources) && listing.sources.length > 0 ? listing.sources : [listing.source];
    return sourceValues
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => this.toSourceLabel(value))
      .join(', ');
  }

  parseListingDetails(value: unknown): Array<{ category: string; parent_category: string; text: string[] }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const typed = entry as {
          category?: unknown;
          parent_category?: unknown;
          text?: unknown;
        };
        return {
          category: typeof typed.category === 'string' ? typed.category : 'Details',
          parent_category: typeof typed.parent_category === 'string' ? typed.parent_category : 'General',
          text: Array.isArray(typed.text) ? typed.text.filter((item): item is string => typeof item === 'string') : []
        };
      })
      .filter((entry): entry is { category: string; parent_category: string; text: string[] } => Boolean(entry));
  }

  getFeeEntries(value: unknown): string[] {
    if (!value || typeof value !== 'object') {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([key, fieldValue]) => `${key.replace(/_/g, ' ')}: ${String(fieldValue)}`)
      .filter((entry) => entry.trim().length > 0);
  }

  private toSourceLabel(source: string): string {
    const normalized = source.trim().toLowerCase();
    if (normalized === 'realtor') {
      return 'Realtor.com';
    }
    if (normalized === 'forrent') {
      return 'ForRent';
    }
    return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  closeCoLikeModal(): void {
    this.coLikeModalEmails = null;
  }

  async openTransferModal(): Promise<void> {
    if (!this.listing || this.pendingTransfer) {
      return;
    }

    this.transferModalError = '';
    this.transferSuccessMessage = '';
    await this.loadTransferLists();
    this.transferOperation = this.canMoveFromCurrentList ? 'move' : 'copy';
    this.targetListSlug = this.filteredTransferTargetLists[0]?.slug ?? '';
    this.showTransferModal = true;
  }

  closeTransferModal(): void {
    if (this.pendingTransfer) {
      return;
    }
    this.showTransferModal = false;
    this.transferModalError = '';
  }

  onTransferOperationChange(operation: ListingTransferOperation): void {
    if (operation === 'move' && !this.canMoveFromCurrentList) {
      this.transferOperation = 'copy';
      return;
    }
    this.transferOperation = operation;
    this.transferModalError = '';
  }

  async confirmTransfer(): Promise<void> {
    if (!this.listing || !this.canSubmitTransfer) {
      return;
    }

    if (this.transferOperation === 'move' && !this.canMoveFromCurrentList) {
      this.transferModalError = 'Move is only available when viewing a custom source list.';
      return;
    }

    this.pendingTransfer = true;
    this.transferModalError = '';
    this.error = '';
    try {
      await this.rentalListingsService.transferListingListMembership({
        listingId: this.listing.id,
        operation: this.transferOperation,
        targetListSlug: this.targetListSlug,
        sourceListSlug: this.transferOperation === 'move' ? this.currentListSlug : undefined
      });
      if (this.transferOperation === 'move') {
        this.currentListSlug = this.targetListSlug;
        await this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { list: this.currentListSlug },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }
      const actionLabel = this.transferOperation === 'move' ? 'Moved' : 'Copied';
      this.transferSuccessMessage = `${actionLabel} listing to ${this.readableListName(this.targetListSlug)}.`;
      this.closeTransferModal();
    } catch (error) {
      this.transferModalError = error instanceof Error ? error.message : 'Failed to transfer listing.';
    } finally {
      this.pendingTransfer = false;
    }
  }

  openCrossOffModal(): void {
    if (!this.listing || this.pendingCrossOff || this.listing.is_crossed_off) {
      return;
    }
    this.showCrossOffModal = true;
    this.selectedCrossOffReason = this.crossOffReasonOptions[0].value;
    this.crossOffModalError = '';
  }

  closeCrossOffModal(): void {
    this.showCrossOffModal = false;
    this.selectedCrossOffReason = '';
    this.crossOffModalError = '';
  }

  async confirmCrossOffListing(): Promise<void> {
    if (!this.listing || this.pendingCrossOff) {
      return;
    }
    if (!this.selectedCrossOffReason) {
      this.crossOffModalError = 'Please select a reason before crossing off.';
      return;
    }

    this.pendingCrossOff = true;
    this.error = '';
    this.crossOffModalError = '';
    try {
      await this.rentalListingsService.crossOffListing(this.listing.id, this.selectedCrossOffReason);
      this.closeCrossOffModal();
      await this.router.navigate(['/']);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to cross off listing.';
    } finally {
      this.pendingCrossOff = false;
    }
  }

  async toggleLike(): Promise<void> {
    if (!this.listing || this.pendingLike) {
      return;
    }

    this.pendingLike = true;
    this.error = '';
    try {
      const response = await this.rentalListingsService.likeListing(this.listing.id, !this.listing.is_liked);
      this.listing = {
        ...this.listing,
        is_liked: response.listing.is_liked
      };
      if (response.listing.is_liked && (response.other_likers?.length ?? 0) > 0) {
        this.coLikeModalEmails = response.other_likers ?? null;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to update listing like.';
    } finally {
      this.pendingLike = false;
    }
  }

  private async loadTransferLists(): Promise<void> {
    this.loadingTransferLists = true;
    try {
      const response = await this.rentalListingsService.getListingLists();
      this.transferLists = response.lists ?? [];
    } catch {
      this.transferLists = [];
    } finally {
      this.loadingTransferLists = false;
    }
  }

  private readableListName(slug: string): string {
    return this.transferLists.find((list) => list.slug === slug)?.name ?? slug;
  }
}
