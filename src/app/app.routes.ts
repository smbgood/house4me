import { Routes } from '@angular/router';
import { GoogleAuthComponent } from './google-auth/google-auth.component';
import { ListingDetailPageComponent } from './listing-detail-page/listing-detail-page.component';
import { LikedListingsPageComponent } from './liked-listings-page/liked-listings-page.component';
import { ListingsPageComponent } from './listings-page/listings-page.component';
import { GoogleAuthGuard } from './services/google-auth.guard';
import { SwipeListingsPageComponent } from './swipe-listings-page/swipe-listings-page.component';

export const routes: Routes = [
  { path: 'google-auth', component: GoogleAuthComponent },
  { path: 'oauth-callback', component: GoogleAuthComponent },
  { path: 'liked-listings', component: LikedListingsPageComponent, canActivate: [GoogleAuthGuard] },
  { path: 'swipe', component: SwipeListingsPageComponent, canActivate: [GoogleAuthGuard] },
  { path: 'listings/:id', component: ListingDetailPageComponent, canActivate: [GoogleAuthGuard] },
  { path: '', component: ListingsPageComponent, canActivate: [GoogleAuthGuard] }
];
