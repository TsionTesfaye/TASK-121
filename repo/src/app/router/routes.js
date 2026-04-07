import LoginPage from '../../pages/LoginPage.svelte';
import BootstrapPage from '../../pages/BootstrapPage.svelte';
import OrgSetupPage from '../../pages/OrgSetupPage.svelte';
import MasterDataPage from '../../pages/MasterDataPage.svelte';
import CRMPage from '../../pages/CRMPage.svelte';
import OrdersPage from '../../pages/OrdersPage.svelte';
import MessagesPage from '../../pages/MessagesPage.svelte';
import NLPPage from '../../pages/NLPPage.svelte';
import RiskReviewPage from '../../pages/RiskReviewPage.svelte';
import AdminPage from '../../pages/AdminPage.svelte';
import TicketsPage from '../../pages/TicketsPage.svelte';

/**
 * Route map: hash path → Svelte page component.
 * All paths correspond to the design spec section 5.2.
 */
export const routes = {
  '/login': LoginPage,
  '/bootstrap': BootstrapPage,
  '/org-setup': OrgSetupPage,
  '/master-data': MasterDataPage,
  '/crm': CRMPage,
  '/orders': OrdersPage,
  '/tickets': TicketsPage,
  '/messages': MessagesPage,
  '/nlp': NLPPage,
  '/risk-review': RiskReviewPage,
  '/admin': AdminPage,
};

/** Default route when no hash is present. */
export const DEFAULT_ROUTE = '/login';

/**
 * Routes accessible without authentication (login + guest).
 * All other routes require an authenticated session.
 */
export const PUBLIC_ROUTES = new Set(['/login', '/bootstrap']);

/**
 * Role-to-accessible-routes map.
 * Administrators can access all routes.
 */
export const ROLE_ROUTES = {
  administrator: new Set(Object.keys(routes)),
  store_manager: new Set(['/crm', '/orders', '/tickets', '/messages', '/master-data', '/risk-review']),
  analyst: new Set(['/nlp', '/crm']),
  reviewer: new Set(['/risk-review', '/tickets']),
  guest: new Set(['/crm']),
};
