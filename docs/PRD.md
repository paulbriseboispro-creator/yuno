# Yuno — Product Requirements Document (PRD)

**Last updated:** 2026-02-19

**Status:** Living document — reflects current implemented state

---

# 1. Product Vision

**Yuno** is a multi-venue nightlife marketplace connecting clubbers with clubs.

Each venue (club, bar, lounge) operates as an independent ecosystem:

* Drinks menu
* Events
* Ticketing
* VIP tables
* Staff management
* Loyalty
* CRM

All managed through a unified owner/manager dashboard.

### Tagline

> **"Your night, simplified."**

### Core Value Propositions

#### For Clubbers

* Discover events
* Pre-order drinks
* Buy tickets
* Reserve VIP tables
* Earn loyalty points

  → All from one app

#### For Venue Owners

* Full back-office SaaS
* Staff management
* Menu & event management
* Analytics & CRM
* Stripe Connect payments

#### For Staff

* Role-specific mobile dashboards:
  * Barman
  * Bouncer
  * VIP Host
  * Cloakroom
  * DJ
* PIN-based quick login

---

# 2. User Personas & Journeys

---

## 2.1 Client (Clubber)

**Profile**

* Age: 18–35
* Goes out 1–4 times/month

**Journey**

Explore → Pick event → Buy ticket / Reserve table / Pre-order drinks →
Check-in (QR) → Order at bar → Earn loyalty → Post-visit recap

**Key Screens**

* Welcome (venue map)
* Explore
* VenuePage
* EventDetails
* Cart
* TicketCheckout
* TableCheckout
* MyOrders
* Profile
* Favorites

---

## 2.2 Owner

**Profile**

* Club/bar owner
* Manages 1+ venues

**Journey**

Onboard venue → Configure menu & events → Monitor analytics →
Manage staff → Run CRM → Track revenue

**Authentication**

* Email + Password
* MFA (TOTP)

**Data Isolation**

* All queries scoped by `venue_id`

**Key Screens**

OwnerDashboard
OwnerEvents
OwnerMenu
OwnerAnalytics
OwnerVenue
OwnerStaff
OwnerTicketing
OwnerTables
OwnerVipService
OwnerCustomers
OwnerLoyalty
OwnerPromoters
OwnerDJs
OwnerRefunds
OwnerInvoices
OwnerEmailCampaign
OwnerHypeAnalysis
OwnerUpsell
OwnerManagers

---

## 2.3 Manager

**Profile**

* Trusted employee
* Delegated owner permissions

**Auth**

* Email login
* Granular permissions (`useManagerPermissions`)

**Permissions**

* manage_events
* manage_menu
* manage_staff
* manage_orders
* manage_tables
* manage_vip
* manage_tickets
* manage_analytics
* manage_customers
* manage_loyalty
* manage_promoters
* manage_djs
* manage_guest_list
* manage_venue

**Key Screens**

* ManagerDashboard (mirrors owner via DashboardModeContext)

---

## 2.4 Staff Roles

### Barman

* PIN login (`barman-pin-login`)
* Select bar
* Manage order queue
* Update order status

Screens:
* BarmanLogin
* Barman

---

### Bouncer

* PIN login (`bouncer-pin-login`)
* Scan QR (tickets & guest list)
* Log incidents

Screens:
* BouncerLogin
* Bouncer

---

### VIP Host

* PIN login
* Floor plan management
* Table reservations
* Minimum spend tracking
* VIP order processing

Screens:
* VipHostLogin
* VipHostDashboard

---

### Cloakroom

* PIN login (`cloakroom-pin-login`)
* Register items
* Generate QR
* Process returns

Screens:
* CloakroomLogin
* CloakroomDashboard

---

### DJ

* Invitation-based
* Manage sets
* Public profile

Screens:
* DJDashboard
* DJPublicPage

---

### Promoter

* Invitation-based
* Tracking link
* Conversion tracking
* Commission management

Screen:
* PromoterDashboard

---

### Super Admin

**Platform Team**

Responsibilities:
* Manage venues
* Global drink catalog
* Waitlist
* Feedback
* Email templates
* Chatbot training
* Platform analytics
* Accounting

Screens:
AdminDashboard
AdminVenues
AdminDrinkCatalog
AdminWaitlist
AdminFeedback
AdminEmailTemplates
AdminChatbotTraining
AdminAnalytics
AdminAccounting

---

# 3. Architecture Overview

---

## 3.1 Tech Stack

| Layer    | Technology                                                   |
| -------- | ------------------------------------------------------------ |
| Frontend | React 18, TypeScript, Vite                                   |
| Styling  | Tailwind CSS, shadcn/ui, Framer Motion                       |
| State    | Zustand, React Query, React Context                          |
| Backend  | Supabase (Postgres, Auth, Edge Functions, Storage, Realtime) |
| Payments | Stripe Connect (Standard)                                    |
| Maps     | Mapbox GL                                                    |
| Charts   | Recharts                                                     |
| i18n     | Custom LanguageContext (EN, FR, ES)                          |
| PWA      | Service worker + push notifications                          |

---

## 3.2 Data Isolation

All venue-specific data is scoped by `venue_id`.

Includes:
* Drinks
* Events
* Orders
* Tickets
* Tables
* Staff
* Customers
* Loyalty
* Campaigns

Rules:
* Owners filtered by venue
* Managers filtered by venue + permissions
* Staff linked via `profiles.venue_id`

---

## 3.3 Authentication Model

| Role     | Method               | Flow                      |
| -------- | -------------------- | ------------------------- |
| Client   | Email/password       | Signup → verification     |
| Owner    | Email/password + MFA | Login → TOTP              |
| Manager  | Email/password       | Permission check          |
| Staff    | PIN                  | Edge validation → session |
| DJ       | Email/password       | Invitation                |
| Promoter | Email/password       | Invitation                |
| Admin    | Email/password       | Role check                |

---

## 3.4 Routing Structure

### Public

```
/ → Welcome
/explore
/venue/:id
/event/:id
/cart
/click-collect
/ticket-checkout
/table-checkout
/my-orders
/profile
/favorites
/auth
```

### Role-Based

```
/owner/*
/manager/*
/barman
/barman-login
/bouncer
/bouncer-login
/vip-host
/vip-host/login
/cloakroom/*
/cloakroom/login
/dj/*
/promoter/*
/admin/*
```

---

# 4. Key Features

---

## 4.1 Client-Facing

| Feature         | Description                  |
| --------------- | ---------------------------- |
| Venue Discovery | Map + search + filters       |
| Event Browsing  | Posters, DJs, badges         |
| Drink Pre-order | Menu → cart → Stripe → QR    |
| Ticket Purchase | Tier selection → QR          |
| VIP Tables      | Zone → table → pack → Stripe |
| Loyalty         | Points → tiers → rewards     |
| Guest List      | QR free entry                |
| Wallet          | Apple/Google pass            |
| Push            | Order updates                |
| Favorites       | Venues, drinks, DJs          |
| Yuno Assistant  | AI chatbot                   |

---

## 4.2 Owner Dashboard

Core modules:
* Dashboard KPIs
* Event CRUD
* Menu CRUD
* Analytics
* Staff management
* CRM
* Ticket tiers
* Floor plan editor
* VIP management
* Promoter tracking
* DJ scheduling
* Guest list config
* Loyalty config
* Upsell engine
* Refunds
* Invoices
* Email builder
* Hype Score AI
* Venue settings
* Waitlist

---

## 4.3 Staff Dashboards

| Role      | Core Capabilities      |
| --------- | ---------------------- |
| Barman    | Order queue + status   |
| Bouncer   | QR scan + incidents    |
| VIP Host  | Floor plan + min spend |
| Cloakroom | Item tracking          |

---

## 4.4 Platform Admin

* Venue approval
* Global drink catalog
* Platform analytics
* Accounting
* Maintenance mode

---

# 5. Design System

---

## 5.1 Theme

* Black background
* Red accent (`--primary: 0 72% 51%`)
* Dark-mode first
* System font stack
* Border radius: 0.5rem

---

## 5.2 CSS Variables

```
--background: 0 0% 7%
--foreground: 0 0% 96%
--card: 0 0% 11%
--primary: 0 72% 51%
--secondary: 0 0% 15%
--muted: 0 0% 15%
--border: 0 0% 18%
```

---

## 5.3 Design Rules

* ❌ No green
* ❌ No generic AI aesthetics
* ✅ Mobile-first
* ✅ Semantic Tailwind tokens only
* ✅ Lazy-loaded images
* ✅ Fully responsive

---

# 6. Payment Architecture

---

## 6.1 Stripe Connect

Flow:
1. Cart (Zustand)
2. Edge function creates Checkout Session
3. Redirect to Stripe
4. Webhook confirmation
5. Verify function updates DB
6. QR confirmation

---

## 6.2 Fee Structure

| Product | Service Fee     | Insurance |
| ------- | --------------- | --------- |
| Drinks  | Per-order       | —         |
| Tickets | Per-ticket      | Optional  |
| Tables  | Per-reservation | —         |

---

# 7. Security Model

---

## 7.1 RLS

* All tables protected
* Scoped by `venue_id`
* Client limited to own records
* Owner/manager limited to venue

---

## 7.2 Role Hierarchy

```
super_admin
  > owner
    > manager
      > staff roles
        > client
```

---

# 8. Edge Functions

### Authentication

* barman-pin-login
* bouncer-pin-login
* cloakroom-pin-login
* verify-pin
* MFA functions

### Payments

* create-checkout
* verify-payment
* stripe-webhook
* owner-refund

### Invitations

* invite-owner
* invite-promoter
* invite-dj

### Notifications

* send-order-confirmation
* send-crm-campaign
* send-push-notification

### Features

* join-waitlist
* guest-list management
* loyalty redemption
* wallet pass
* yuno-assistant
* subscription management
* cleanup jobs
* maintenance password

---

# 9. Conversion Funnel

Tracked via `visitor_sessions`:

1. Page View
2. Add to Cart
3. Checkout
4. Purchase

Used for:
* Promoter attribution
* Analytics

---

# 10. Key Database Tables

Grouped by domain:

Core: venues, profiles, user_roles
Menu: drinks, drink_catalog
Events: events, event_djs
Orders: orders, order_items
Tickets: tickets, ticket_tiers
Tables: table_reservations, venue_tables
Staff: employees, djs
Loyalty: customer_loyalty
CRM: venue_customers
Promoters: promoter_clicks
Finance: invoices
Platform: app_settings
Tracking: visitor_sessions

---

# 11. Pending / Future Work

* Complete i18n (owner + admin)
* Demo mode
* Full E2E payment tests
* Offline-first PWA
* Real-time Supabase orders
* Advanced analytics (cohort, retention)
* Multi-venue owner support
