export interface Role {
  id: string;
  title: string;
  company: string;
  dates: string;
  context: string;
}
export interface Thread {
  id: string;
  title: string;
  role_id: string | null;
  phase: 'recall' | 'discovery';
  session: any;
  events: any[];
  updated_at: string;
}
export interface Message {
  id: string;
  thread_id: string;
  kind: 'user' | 'assistant';
  body: string;
  created_at: string;
}
export interface Entry {
  id: string;
  role_id: string | null;
  title: string;
  markdown: string;
  skills: string[];
  revision: number;
  updated_at: string;
  source_message_ids?: string[];
}
export interface Topic {
  id: string;
  role_id: string | null;
  label: string;
  status: 'unexplored' | 'exploring' | 'sufficient' | 'revisit';
  notes: string;
}
export interface Requirement {
  label: string;
  kind: 'technical' | 'collaboration' | 'leadership' | 'product' | 'delivery' | 'other';
  section: string;
  quote: string;
}
export interface Listing {
  id: string;
  url: string;
  source_url: string;
  title: string;
  company: string;
  family: string;
  seniority: string;
  location: string;
  arrangement: string;
  description: string;
  requirements: Requirement[];
  status: 'queued' | 'fetching' | 'needs_browser' | 'extracting' | 'ready' | 'failed';
  error: string | null;
  duplicate_of: string | null;
  collected_at: string;
  content_hash: string | null;
}
export interface Settings {
  reviewRequired: boolean;
  interviewModel: string;
  extractionModel: string;
}
export interface Proposal {
  id: string;
  entry_id: string | null;
  action: 'entries.save' | 'roles.save' | 'topics.save';
  payload: Partial<EntryInput> & {
    id: string;
    company?: string;
    dates?: string;
    context?: string;
    label?: string;
    status?: Topic['status'];
    notes?: string;
  };
}
export interface EntryInput {
  id?: string;
  roleId?: string | null;
  title: string;
  markdown: string;
  skills: string[];
  sourceMessageIds: string[];
  expectedRevision?: number;
}
export interface Workspace {
  roles: Role[];
  threads: Thread[];
  entries: Entry[];
  topics: Topic[];
  listings: Listing[];
  requirements: {
    label: string;
    kind: string;
    count: number;
    families: string[];
    listingIds: string[];
  }[];
  proposals: Proposal[];
  settings: Settings;
  storage: 'neon' | 'local';
  modelConnection: 'subscription' | 'gateway' | 'disabled';
}
