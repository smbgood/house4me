describe('Rental aggregator listing filters', () => {
  const listings = [
    {
      id: '1',
      source: 'zillow',
      listing_url: 'https://example.com/zillow-1',
      image_url: null,
      title: 'Blue Ranch',
      address: '123 Maple St',
      city: 'Nashville',
      state: 'TN',
      zip: '37201',
      rent_price: 2200,
      bedrooms: 3,
      bathrooms: 2,
      allows_pets: true,
      has_fence: true,
      status: 'active',
      last_seen_at: '2026-06-04T12:00:00.000Z'
    },
    {
      id: '2',
      source: 'trulia',
      listing_url: 'https://example.com/trulia-1',
      image_url: null,
      title: 'City Duplex',
      address: '50 River Rd',
      city: 'Nashville',
      state: 'TN',
      zip: '37201',
      rent_price: 1700,
      bedrooms: 2,
      bathrooms: 1.5,
      allows_pets: false,
      has_fence: false,
      status: 'active',
      last_seen_at: '2026-06-04T12:00:00.000Z'
    },
    {
      id: '3',
      source: 'forrent',
      listing_url: 'https://example.com/forrent-1',
      image_url: null,
      title: 'Parkside Home',
      address: '88 Park Ave',
      city: 'Nashville',
      state: 'TN',
      zip: '37201',
      rent_price: 1900,
      bedrooms: 2,
      bathrooms: 2,
      allows_pets: true,
      has_fence: false,
      status: 'active',
      last_seen_at: '2026-06-04T12:00:00.000Z'
    }
  ];

  function filterListings(query: Record<string, string | number>): typeof listings {
    return listings.filter((listing) => {
      if (query['source'] && listing.source !== query['source']) {
        return false;
      }
      if (query['pets'] && String(listing.allows_pets) !== String(query['pets'])) {
        return false;
      }
      if (query['fence'] && String(listing.has_fence) !== String(query['fence'])) {
        return false;
      }
      if (query['minRent'] && listing.rent_price < Number(query['minRent'])) {
        return false;
      }
      if (query['maxRent'] && listing.rent_price > Number(query['maxRent'])) {
        return false;
      }
      if (
        query['q'] &&
        !`${listing.title} ${listing.address}`.toLowerCase().includes(String(query['q']).toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }

  beforeEach(() => {
    cy.intercept('GET', 'http://localhost:9999/.netlify/functions/verify-google-token', {
      statusCode: 200,
      body: { success: true, email: 'authorized@example.com' }
    }).as('verifyGoogleToken');

    cy.intercept('GET', 'http://localhost:9999/.netlify/functions/get-listings*', (req) => {
      expect(req.headers).to.have.property('authorization');
      req.reply({
        statusCode: 200,
        body: {
          listings: filterListings(req.query as Record<string, string | number>),
          syncStatus: []
        }
      });
    }).as('getListings');
  });

  it('renders listings and applies filters', () => {
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('google_refresh_token', 'test-refresh-token');
      }
    });
    cy.wait('@verifyGoogleToken');
    cy.wait('@getListings');
    cy.contains('Blue Ranch').should('be.visible');
    cy.contains('City Duplex').should('be.visible');
    cy.contains('Parkside Home').should('be.visible');

    cy.get('select').eq(1).select('Allows pets');
    cy.contains('button', 'Apply filters').click();
    cy.wait('@getListings');
    cy.contains('Blue Ranch').should('be.visible');
    cy.contains('Parkside Home').should('be.visible');
    cy.contains('City Duplex').should('not.exist');

    cy.get('select').eq(0).select('ForRent');
    cy.contains('button', 'Apply filters').click();
    cy.wait('@getListings');
    cy.contains('Parkside Home').should('be.visible');
    cy.contains('Blue Ranch').should('not.exist');
  });

});
