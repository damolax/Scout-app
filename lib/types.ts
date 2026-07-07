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
  sent_today?: number | null;
  paused_until?: string | null;
  last_error?: string | null;
  raw?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
};
