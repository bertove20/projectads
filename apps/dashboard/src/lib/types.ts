export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  role: { key: string; name: string };
  dataScope: 'ALL' | 'ASSIGNED';
  permissions: string[];
}

export interface Me {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  mfaSetupRequired: boolean;
  organizations: OrgSummary[];
}

export type ActiveStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface NetworkAccount extends NetworkIntegration {
  id: string;
  network: string;
  name: string;
  paramMapping: Record<string, string>;
  postbackConfigured: boolean;
  postbackSuccessPattern: string | null;
  testMode: boolean;
  status: ActiveStatus;
  createdAt: string;
  credentials?: Array<{ kind: string; hint: string | null; rotatedAt: string | null; createdAt: string }>;
}

export interface Offer {
  id: string;
  name: string;
  url: string;
  payoutType: string;
  payoutAmount: string;
  currency: string;
  geos: string[];
  status: ActiveStatus;
  affiliateNetwork: { id: string; name: string } | null;
}

export interface AffiliateNetwork {
  id: string;
  name: string;
  allowedIps: string[];
  paramMapping: Record<string, string>;
  status: ActiveStatus;
  createdAt: string;
}

export interface Website {
  id: string;
  name: string;
  domain: string;
  status: ActiveStatus;
}

export interface LandingPage {
  id: string;
  name: string;
  url: string;
  status: ActiveStatus;
  website: { id: string; name: string; domain: string } | null;
}

export interface Campaign {
  id: string;
  name: string;
  token: string;
  externalCampaignId: string | null;
  adFormat: string;
  adFormatNetwork: string | null;
  bidModel: string;
  bidAmount: string | null;
  targetCpa: string | null;
  currency: string;
  flowType: 'DIRECT' | 'LANDING';
  offerId: string | null;
  landingPageId: string | null;
  fallbackUrl: string | null;
  conversionGoal: string;
  postbackEnabled: boolean;
  status: ActiveStatus;
  createdAt: string;
  networkAccount: { id: string; name: string; network: string; testMode?: boolean; postbackConfigured?: boolean };
  offer?: { id: string; name: string } | null;
  landingPage?: { id: string; name: string } | null;
  trackingDomainId?: string | null;
  trackingLink?: { base: string; example: string; clickOut: string; domain: { hostname: string; status: string } | null };
}

export interface ReportRow {
  key: string | null;
  label: string;
  clicks: number;
  botClicks: number;
  clickOuts: number;
  conversions: number;
  pendingConversions: number;
  revenue: number;
  otherCurrencyConversions: number;
  spend: number;
  spendSource: 'reported' | 'estimated' | 'none';
  profit: number;
  cr: number | null;
  epc: number | null;
  cpa: number | null;
  roi: number | null;
}

export interface Report {
  currency: string;
  timezone: string;
  rows: ReportRow[];
  totals: ReportRow;
  notes: string[];
}

export interface Conversion {
  id: string;
  createdAt: string;
  status: string;
  goal: string;
  payout: string;
  currency: string;
  transactionId: string | null;
  clickId: string;
  campaign: { id: string; name: string };
  offer: { id: string; name: string } | null;
  affiliateNetwork: { id: string; name: string } | null;
  deliveries: Array<{ id: string; status: string; providerAccepted: boolean | null; attempts: number }>;
}

export interface Delivery {
  id: string;
  createdAt: string;
  status: string;
  attempts: number;
  targetHost: string | null;
  lastStatusCode: number | null;
  lastResponse: string | null;
  lastError: string | null;
  providerAccepted: boolean | null;
  networkAccount: { id: string; name: string; network: string };
  conversion: { id: string; campaignId: string; payout: string; currency: string };
}

export interface InboundLog {
  id: string;
  receivedAt: string;
  method: string;
  params: Record<string, string>;
  result: string;
  message: string | null;
  conversionId: string | null;
  affiliateNetwork: { id: string; name: string };
}

export interface Member {
  id: string;
  user: { id: string; email: string; name: string; mfaEnabled: boolean; lastLoginAt: string | null; status: string };
  role: { key: string; name: string };
  dataScope: 'ALL' | 'ASSIGNED';
  status: 'ACTIVE' | 'DISABLED';
  campaignIds: string[];
  createdAt: string;
}

export interface RoleDef {
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export interface AuditLog {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export const AD_FORMATS = ['PUSH', 'ONCLICK', 'IN_PAGE_PUSH', 'DIRECT_CLICK', 'NATIVE', 'BANNER', 'INTERSTITIAL', 'OTHER'] as const;
export const BID_MODELS = ['CPC', 'SMART_CPC', 'CPA_GOAL_CPC', 'CPM', 'SMART_CPM', 'CPA_GOAL_CPM', 'CPA', 'OTHER'] as const;
export const NETWORKS = ['ROLLERADS', 'CLICKADU', 'PROPELLERADS', 'EVADAV', 'META', 'GOOGLE', 'OTHER'] as const;

export const LABELS: Record<string, string> = {
  PUSH: 'Push',
  ONCLICK: 'OnClick (Popunder)',
  IN_PAGE_PUSH: 'In-Page Push',
  DIRECT_CLICK: 'Direct Click',
  NATIVE: 'Native',
  BANNER: 'Banner',
  INTERSTITIAL: 'Interstitial',
  OTHER: 'Lainnya',
  CPC: 'CPC',
  SMART_CPC: 'SmartCPC',
  CPA_GOAL_CPC: 'CPA Goal CPC',
  CPM: 'CPM',
  SMART_CPM: 'SmartCPM',
  CPA_GOAL_CPM: 'CPA Goal CPM',
  CPA: 'CPA',
  ROLLERADS: 'RollerAds',
  CLICKADU: 'Clickadu',
  PROPELLERADS: 'PropellerAds',
  EVADAV: 'EvaDav',
  META: 'Meta Ads',
  GOOGLE: 'Google Ads',
  DIRECT: 'Iklan → Offer',
  LANDING: 'Iklan → Landing → Offer',
};

export const label = (v: string | null | undefined) => (v ? (LABELS[v] ?? v) : '—');

// ───────────── Phase 2 ─────────────

export interface NetworkIntegration {
  apiConfigured: boolean;
  externalAccountId: string | null;
  networkTimezone: string | null;
  networkCurrency: string | null;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | null;
  lastSyncError: string | null;
}

export interface SyncRun {
  id: string;
  trigger: string;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  rangeFrom: string;
  rangeTo: string;
  requestCount: number;
  rowsUpserted: number;
  unmappedCampaigns: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RemoteCampaign {
  id: string;
  title: string;
  status: string;
  mappedTo: { id: string; name: string } | null;
}

export interface ReconRow {
  campaignId: string;
  campaign: string;
  date: string;
  isToday: boolean;
  networkImpressions: number;
  networkClicks: number;
  internalClicks: number;
  internalBotClicks: number;
  clickGap: number | null;
  networkConversions: number;
  internalVerified: number;
  postbacksDelivered: number;
  conversionGap: number | null;
  networkSpend: number;
  flagged: boolean;
}

export interface Reconciliation {
  timezone: string;
  timezoneSource: 'network' | 'fallback-utc';
  currency: string;
  thresholdPct: number;
  minClicks: number;
  lastSyncAt: string | null;
  range: { from: string; to: string };
  rows: ReconRow[];
  unmappedCampaigns: Array<{ externalCampaignId: string; spend: number; clicks: number }>;
}

export interface ZoneRow {
  zoneId: string;
  clicks: number;
  botClicks: number;
  botRate: number | null;
  conversions: number;
  revenue: number;
  networkClicks: number | null;
  networkConversions: number | null;
  spend: number;
  spendSource: 'network' | 'estimated' | 'none';
  profit: number;
  roi: number | null;
  cpa: number | null;
  flags: string[];
  listed: { id: string; listType: 'BLACKLIST' | 'WHITELIST'; scope: 'campaign' | 'account' } | null;
}

export interface ZoneReport {
  timezone: string;
  currency: string;
  networkCurrency: string | null;
  range: { from: string; to: string };
  targetCpa: number | null;
  targetSource: 'campaign' | 'offer_payout' | null;
  rows: ZoneRow[];
  notes: string[];
}

export interface ZoneListEntry {
  id: string;
  zoneId: string;
  listType: 'BLACKLIST' | 'WHITELIST';
  reason: string | null;
  createdAt: string;
  campaign: { id: string; name: string } | null;
  networkAccount: { id: string; name: string; network: string };
}

export type Severity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

export interface AlertItem {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  body: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  occurrences: number;
  createdAt: string;
  lastSeenAt: string;
  entityType: string | null;
  entityId: string | null;
  deliveries: Array<{ status: string; error: string | null; channel: { name: string } }>;
}

export interface NotificationChannel {
  id: string;
  type: 'TELEGRAM' | 'DISCORD';
  name: string;
  target: string;
  secretHint: string | null;
  minSeverity: Severity;
  enabled: boolean;
  commandsEnabled: boolean;
  teamUpdates: boolean;
  config: { applicationId?: string | null; publicKey?: string | null } | null;
  lastTestAt: string | null;
  createdAt: string;
}

// ───────────── Phase 3 ─────────────

export interface RouteConditions {
  countries?: string[];
  devices?: string[];
  os?: string[];
  browsers?: string[];
  languages?: string[];
}

export interface RouteVariantItem {
  id: string;
  label: string;
  offerId: string;
  landingPageId: string | null;
  weight: number;
  enabled: boolean;
  offer: { id: string; name: string; status: ActiveStatus };
  landingPage: { id: string; name: string; status: ActiveStatus } | null;
}

export interface CampaignRouteItem {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RouteConditions;
  variants: RouteVariantItem[];
}

export type Verdict = 'insufficient_data' | 'no_difference' | 'better' | 'worse' | 'control';

export interface SplitTestReport {
  days: number;
  currency: string;
  thresholds: { minClicks: number; minConversions: number; alpha: number };
  routes: Array<{
    id: string;
    name: string;
    enabled: boolean;
    variants: Array<{
      id: string;
      label: string;
      enabled: boolean;
      offer: { name: string };
      landingPage: { name: string } | null;
      trafficShare: number;
      clicks: number;
      botClicks: number;
      conversions: number;
      revenue: number;
      cr: number | null;
      crInterval: { low: number; high: number } | null;
      epc: number | null;
      pValue: number | null;
      verdict: Verdict;
    }>;
  }>;
}

export interface FunnelReport {
  sdkActive: boolean;
  stages: Array<{ key: string; label: string; count: number; source: 'tracker' | 'sdk_observed' | 'postback_verified'; rateFromClick: number | null; rateFromPrevious: number | null }>;
  notes: string[];
}

export interface WebsiteWithSdk extends Website {
  sdkKey: string | null;
  sdkSnippet: string | null;
  extraDomains: string[];
  requireConsent: boolean;
}

// ───────────── Domain ─────────────

export interface TrackingDomainItem {
  id: string;
  hostname: string;
  status: 'PENDING' | 'ACTIVE' | 'FAILED';
  verifiedAt: string | null;
  lastCheckAt: string | null;
  lastError: string | null;
  createdAt: string;
  website: { id: string; name: string; domain: string } | null;
  campaignCount: number;
  dns: { type: string; name: string; value: string };
}

export interface DomainsResponse {
  platform: { trackerHost: string; postbackHost: string; adminHost: string };
  domains: TrackingDomainItem[];
}
