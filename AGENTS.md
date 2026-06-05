---
name: "Modern Angular Project Template"
description: "A comprehensive development guide for modern frontend projects based on Angular & Ts"
category: "Frontend Framework"
author: "Chase Turner
authorUrl: "https://github.com/smbgood"
tags: ["angular", "typescript", "frontend"]
lastUpdated: "2026-05-20"
---

# Modern Angular Project Development Guide

## Project Overview

This is a modern frontend project template based on Angular, TypeScript and Netlify. It's suitable for building and quickly deploying web application infrastructure.

## Tech Stack

- **Frontend Framework**: Angular + TypeScript
- **Build Tool**: Netlify
- **Routing**: Angular
- **UI Components**: Material-UI
- **Styling**: CSS / Styled-components
- **HTTP Client**: Axios / fetch
- **Testing Framework**: Cypress
- **Code Quality**: ESLint

## Project Structure

```
ewail/
├── netlify/                 
│   └── functions/            # Netlify serverless functions
│   │   ├── submit-form.ts/ 
├── src/
│   ├── app/         # Web Application Angular Components
│   │   ├── about/        # About Page
│   │   └── contact/            # Contact Us Page
│   │   └── faq/            # Faq Page
│   │   └── footer/            # Shared Footer Component
│   │   └── header/            # Shared Header Component
│   │   └── home/            # Home Page
│   │   └── services/            # Services Page
│   │   └── success/            # Form Submit Sucess Page
│   ├── assets/             # Favicon, logos, other site assets
│   ├── environments/             # Environment specific angular config values
├── package.json
├── tsconfig.json
├── angular.json
├── netlify.toml
└── README.md
```

## Development Guidelines

### Component Development Standards

#### Key points

    netlify/functions houses all serverless functions. Each file name
    becomes the endpoint name under /.netlify/functions/<file-name>. For
    example, get-bookings.ts exposes the endpoint
    /.netlify/functions/get-bookings which returns a list of accepted
    bookings

    src/app/services contains Angular services that encapsulate HTTP
    requests to the backend. The PublicBookingService class, for
    instance, uses Angular’s HttpClient and the base URL from
    environment.apiUrl to call /booking, /get-booking and
    /get-public-bookings

    src/environments stores environment-specific configuration. In
    development builds, environment.ts provides variables like
    apiUrl, googleClientId and googleRedirectUri

    The build system replaces this file with environment.prod.ts during production builds,
    so never hard‑code secrets or URLs directly in components or services. Secrets are stored in netlify
    and injected at build time.

### Serverless Function Guidelines

When authoring Netlify functions, adhere to the following:

    Single Responsibility – each function should handle one API
    endpoint. Avoid combining unrelated endpoints into a single file.

    Handler Signature – export a handler (or a named handler) that
    matches the @netlify/functions signature. It receives an event and
    context and returns an object with statusCode, headers and
    optional body. For example, the get-bookings function returns a
    JSON payload of accepted bookings
    
    HTTP Methods and CORS – explicitly check the httpMethod of
    incoming requests and return a 405 for unsupported methods. Add
    CORS headers (Access-Control-Allow-Origin, Access-Control-Allow-Methods and
    Access-Control-Allow-Headers) and handle OPTIONS requests early
    GitHub
    
    TypeScript Types – define TypeScript interfaces for request bodies and
    use them to type the parsed event.body. In create-calendar-event.ts, a
    RequestBody interface describes the expected shape of the booking
    payload
   
    Environment Variables – access sensitive data (API keys,
    repository names, tokens) via process.env. For example, the
    GitHub token, repository owner and repo name are read from the
    environment in update-booking-calendar.ts
    Avoid hard‑coding such values.

    External API Calls – use robust libraries for third‑party
    integrations. 

    Error Handling – wrap asynchronous calls in try/catch. Return
    appropriate status codes (401, 404, 500) and JSON bodies when
    errors occur
    Log internal errors to aid debugging without leaking sensitive details in responses.

    Runtime and Included Files – specify the Node runtime and any
    additional included files in netlify.toml. In ewail the
    functions section uses runtime = "nodejs18" and lists
    included_files = ["netlify/functions/types/**"]

### Angular Frontend Guidelines

Angular’s architecture promotes modularity and separation of concerns.
Adopt the following practices to create maintainable components and
services:

    Service‑Driven Data Access – create services in
    src/app/services for all public-facing HTTP interactions. Inject HttpClient
    into services and return typed observables or promises. This keeps
    components free of networking logic. For example, PublicBookingService
    exposes methods such as submitBooking, getBooking and
    getAcceptedBookings that wrap calls to Netlify functions

    Strongly Typed Models – define interfaces or classes for domain
    objects (e.g., BookingData, PublicBookingData) and annotate
    service methods accordingly. Avoid any and use unknown with
    narrowing when necessary.

    Environment Configuration – read API base URLs and other
    configuration from the environment files. For instance, the
    apiUrl variable points to https://<your-site>.netlify.app/.netlify/functions
    in development
    For local development with
    netlify dev, set apiUrl to the local functions endpoint (e.g.
    http://localhost:9999/.netlify/functions).

    Component Naming and File Conventions – follow Angular CLI
    conventions:

        Component classes are in PascalCase with a Component suffix
        (CalendarComponent).

        Service classes end with Service (PublicBookingService).

        File names use kebab‑case and include a .component.ts or
        .service.ts suffix.

        CSS/SCSS and template files share the same prefix as their
        component.

    Change Detection and Performance – prefer
    ChangeDetectionStrategy.OnPush for presentational components to
    minimise unnecessary change detection cycles. Use the async pipe
    to subscribe to observables in templates. Avoid expensive logic in
    templates; compute values in component methods instead.

    Single Responsibility Components – each component should focus
    on a single piece of functionality. Complex logic, such as
    calculating available time slots and durations, can still reside in
    the component but should be broken into private helper methods to
    keep the code readable

    Legacy/Backwards Compatibility - whenever a currently existing component is having a new feature added,
    unless the requirements specifically state to support some elements of the previous data structure,
    do not make new features support legacy code or old data structures.

    Forms and Validation – utilise Angular’s reactive forms for
    complex input. Validate user input before sending requests to the
    backend and provide helpful error messages. For simple forms, the
    template‑driven approach is acceptable.

    Error Handling and User Feedback – wrap service calls in
    try/catch (or subscribe with error callbacks) and display friendly
    messages to users when requests fail. Logging can help track issues
    during development

    Accessibility – ensure interactive elements are keyboard
    accessible (tabindex, role attributes) and use semantic HTML.
    Provide appropriate ARIA labels for buttons and form controls. Test
    screens with assistive technologies.

    Testing – only perform linting and basic compilation to test

### Naming Conventions and Style

Consistent naming and formatting make code easier to navigate:

    Classes – PascalCase (UserCardComponent, PublicBookingService).

    Files – kebab-case (user-card.component.ts, public-booking.service.ts).

    Selectors – prefix component selectors with app- followed by
    kebab-case (app-calendar).

    Functions – Netlify function file names use hyphen‑separated
    lowercase words (create-calendar-event.ts) to map cleanly to
    endpoint names.

    Variables and Properties – camelCase for variables and
    properties; UPPER_SNAKE_CASE for constants.

Stick to an opinionated formatter (e.g., Prettier) and a linter (e.g.,
ESLint) to enforce consistent style across the codebase.
### Deployment and Environment Configuration
Building and Deploying

The build command in netlify.toml should invoke Angular’s production
build. In ewail it is ng build --configuration=production

Adjust the publish directory to match your
project name (dist/<project-name>).

Set functions = "netlify/functions" to tell Netlify where to find
serverless functions

For local development, make code changes and allow the user to test

### Environment Variables

    Define your environment variables in the Netlify dashboard or use a
    .env file locally (supported by the Netlify CLI). Variables such as
    GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GOOGLE_CLIENT_ID
    and GOOGLE_CLIENT_SECRET are critical for functions like
    get-bookings and create-calendar-event

    In Angular, variables like apiUrl and OAuth client IDs should be
    placed in the environment files. Never expose secrets on the client.

    Use different settings for development and production. For instance,
    local development might point apiUrl to http://localhost:9999/.netlify/functions;
    production points to your Netlify domain (e.g., https://mysite.netlify.app/.netlify/functions).


## Testing Strategy

Do not spend time/resources on performing unit testing

Do not create Cypress End-to-End tests to perform basic regression / functional validation, instead compile files where appropriate but mostly rely on the user to test live

Lint the code and perform whatever static analysis you wish to catch syntax errors, but do not spend resources to build or run the code, the user will perform that task
