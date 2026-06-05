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
      is_crossed_off: false,
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
      is_crossed_off: false,
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
      is_crossed_off: false,
      status: 'active',
      last_seen_at: '2026-06-04T12:00:00.000Z'
    },
    {
      id: '4',
      source: 'realtor',
      listing_url: 'https://example.com/realtor-1',
      image_url: null,
      title: 'Maple Family Home',
      address: '42 Pappy Ln',
      city: 'Garner',
      state: 'NC',
      zip: '27529',
      rent_price: 2975,
      bedrooms: 4,
      bathrooms: 3,
      allows_pets: true,
      has_fence: true,
      available_date: '2026-06-04',
      sqft: 2717,
      description_text: 'Lease this home and get more from Invitation Homes professional property management.',
      management_company: 'Invitation Homes',
      landlord_name: 'Invitation Homes',
      tags: ['pets_allowed', 'fenced_yard'],
      listing_details: [
        {
          category: 'Bedrooms',
          parent_category: 'Interior',
          text: ['Bedrooms: 4']
        }
      ],
      fees: {
        monthly_fees_text: 'Air Filter Delivery Fee: $10, Internet & Media: $85'
      },
      photo_count: 26,
      is_crossed_off: false,
      status: 'active',
      last_seen_at: '2026-06-04T12:00:00.000Z'
    }
  ];

  const crossedOffIds = new Set<string>();

  function filterListings(query: Record<string, string | number>): typeof listings {
    return listings.filter((listing) => {
      if (crossedOffIds.has(listing.id)) {
        return false;
      }
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

    cy.intercept('POST', 'http://localhost:9999/.netlify/functions/cross-off-listing', (req) => {
      expect(req.headers).to.have.property('authorization');
      const id = String((req.body as { id?: string })?.id ?? '');
      const crossOffReason = String((req.body as { crossOffReason?: string })?.crossOffReason ?? '');
      const listing = listings.find((item) => item.id === id);
      if (!listing) {
        req.reply({ statusCode: 404, body: { error: 'Listing not found.' } });
        return;
      }
      expect(crossOffReason).to.eq('did_not_match_requirements');
      crossedOffIds.add(id);
      req.reply({
        statusCode: 200,
        body: {
          listing: {
            id,
            is_crossed_off: true,
            cross_off_reason: crossOffReason,
            crossed_off_by: 'authorized@example.com',
            crossed_off_at: '2026-06-05T12:00:00.000Z'
          }
        }
      });
    }).as('crossOffListing');

    cy.intercept('GET', 'http://localhost:9999/.netlify/functions/get-listing*', (req) => {
      expect(req.headers).to.have.property('authorization');
      const id = String(req.query['id'] ?? '');
      const listing = listings.find((item) => item.id === id);
      if (!listing) {
        req.reply({ statusCode: 404, body: { error: 'Listing not found.' } });
        return;
      }
      req.reply({
        statusCode: 200,
        body: { listing }
      });
    }).as('getListing');
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
    cy.contains('Maple Family Home').should('be.visible');

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

    cy.get('select').eq(0).select('All');
    cy.contains('button', 'Apply filters').click();
    cy.wait('@getListings');
    cy.contains('article', 'Blue Ranch').within(() => {
      cy.contains('button', 'Cross off').click();
    });
    cy.contains('h2', 'Why are you crossing off this listing?').should('be.visible');
    cy.get('.modal-card select').select('Did Not Match Requirements');
    cy.contains('.modal-card button', 'Confirm cross off').click();
    cy.wait('@crossOffListing');
    cy.contains('Blue Ranch').should('not.exist');
    cy.contains('a', 'Maple Family Home').click();
    cy.wait('@getListing');
    cy.url().should('include', '/listings/4');
    cy.contains('Description').should('be.visible');
    cy.contains('Invitation Homes').should('be.visible');
  });

});
