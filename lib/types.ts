export type BusinessStatus =
  | 'pending'
  | 'scanning'
  | 'found'
  | 'ready'
  | 'review'
  | 'contacted'
  | 'responded'
  | 'no_inbox'
  | 'bounced'
  | 'invalid'
  | 'duplicate'
  | 'archived';

export type Workspace = {
  id: string;
  name: string;
  api_key?: string | null;
};

export type Business = {
  id: string;
  workspace_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  domain: string | null;
  category: string | null;
  location: string | null;
  source: string | null;
  status: BusinessStatus;
  score: number | null;
  normalized_key: string;
  raw: Record<string, unknown> | null;
  reply_state?: string | null;
  last_reply_classification?: string | null;
  last_inbound_at?: string | null;
  last_auto_reply_at?: string | null;
  last_real_reply_at?: string | null;
  social_links?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type CsvBusinessInput = {
  name: string;
  email: string;
  phone: string;
  website: string;
  domain: string;
  category: string;
  location: string;
  source: string;
  normalized_key: string;
  raw: Record<string, unknown>;
};


export type CsvInvalidRow = {
  rowNumber: number;
  reason: string;
  raw: Record<string, unknown>;
};

export type DuplicateSource = 'queue' | 'scout_history';

export type ExistingKeyRecord = {
  normalized_key: string;
  source: DuplicateSource;
};

export type ImportResult = {
  uploaded: number;
  inserted: number;
  skippedExistingQueue: number;
  skippedScouted: number;
  skippedFileDuplicates: number;
  invalidRows: CsvInvalidRow[];
  skippedRows: CsvBusinessInput[];
  batchId?: string;
  queuedResearch?: number;
};

export type EmailResearchJob = {
  id: string;
  workspace_id: string;
  business_id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  priority: number;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};


export type MessageTemplate = {
  id: string;
  workspace_id: string;
  name: string;
  subject: string;
  subject_variants?: string[] | null;
  category_id?: string | null;
  category_name?: string | null;
  message: string;
  active?: boolean | null;
  created_by: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type ReplyHistory = {
  id: string;
  workspace_id: string;
  business_id?: string | null;
  sent_message_id?: string | null;
  template_id?: string | null;
  gmail_account_id?: string | null;
  batch_id?: string | null;
  from_email?: string | null;
  to_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
  body?: string | null;
  classification?: string | null;
  is_real_reply?: boolean | null;
  is_auto_reply?: boolean | null;
  is_delivery_failure?: boolean | null;
  is_blocked?: boolean | null;
  is_limit_notice?: boolean | null;
  is_temporary?: boolean | null;
  reply_bucket?: string | null;
  received_at?: string | null;
  gmail_message_id?: string | null;
  gmail_thread_id?: string | null;
  raw?: Record<string, unknown> | null;
};

export type GmailAccount = {
  id: string;
  workspace_id: string;
  email: string;
  display_name: string | null;
  status: string;
  access_token?: string | null;
  refresh_token?: string | null;
  client_id?: string | null;
  expires_at?: string | null;
  daily_limit?: number | null;
  default_run_limit?: number | null;
  account_type?: string | null;
  seed_inbox_enabled?: boolean | null;
  seed_test_address?: string | null;
  spam_risk_status?: string | null;
  last_seed_result?: string | null;
  last_seed_checked_at?: string | null;
  sent_today?: number | null;
  paused_until?: string | null;
  last_error?: string | null;
  raw?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
};


export type MessageCategory = {
  id: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MessageSchedule = {
  id: string;
  workspace_id: string;
  type: 'initial' | 'follow_up';
  category_id?: string | null;
  template_id?: string | null;
  target_count?: number | null;
  scheduled_for: string;
  status: 'scheduled' | 'due' | 'running' | 'sent' | 'cancelled' | 'failed';
  raw?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
};


export type SeedInboxTest = {
  id: string;
  workspace_id: string;
  sender_gmail_account_id?: string | null;
  seed_gmail_account_id?: string | null;
  sender_email?: string | null;
  seed_email?: string | null;
  subject?: string | null;
  placement?: 'inbox' | 'spam' | 'promotions' | 'blocked' | 'bounced' | 'not_found' | 'sent_pending_check' | string | null;
  checked_at?: string | null;
  created_at?: string | null;
  raw?: Record<string, unknown> | null;
};
