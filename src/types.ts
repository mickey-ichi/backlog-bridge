// Shared types: Backlog API v2 responses (only the fields the code uses) + the config.json schema.
// Docs: https://developer.nulab.com/docs/backlog/

// --- Backlog API ---
export interface Named {
  id: number;
  name: string;
}

export interface Status extends Named {
  displayOrder?: number;
}

export interface User extends Named {
  userId?: string;
}

export interface Project extends Named {
  projectKey: string;
}

export interface CustomFieldItem extends Named {}

export interface CustomField extends Named {
  required?: boolean;
  applicableIssueTypes?: number[];
  items?: CustomFieldItem[];
}

export interface Issue {
  id: number;
  issueKey: string;
  summary: string;
  description?: string | null;
  issueType?: Named | null;
  priority?: Named | null;
  status?: Status | null;
  assignee?: User | null;
  startDate?: string | null;
  dueDate?: string | null;
  updated?: string;
  estimatedHours?: number | null;
  parentIssueId?: number | null;
  milestone?: Named[];
}

export interface Comment {
  id: number;
  content: string | null;
  created: string;
  createdUser?: User;
}

export interface Activity {
  type: number;
  created: string;
  createdUser?: User;
  project?: Project;
  content?: { key_id?: number; summary?: string };
}

// Query/body values sent to the API: arrays -> repeated keys (see BacklogClient).
export type ParamValue = string | number | boolean | null | undefined | Array<string | number>;
export type Params = Record<string, ParamValue>;

// --- config.json ---
export interface SpaceSpec {
  env: string;
  envFallback?: string;
}

export interface Credentials {
  space: string;
  apiKey: string;
}

export interface Side {
  space: string;
  projectKey: string;
}

export interface MirrorProfile {
  mode: "mirror";
  note?: string;
  source: Side;
  dest: Side & { customFields?: Record<string, string | number | Array<string | number>> };
  state?: string;
  filter?: { requireDueDate?: boolean; assignees?: string[] };
  map?: {
    issueType?: Record<string, string>;
    priority?: Record<string, string>;
    status?: Record<string, string>;
    assignee?: Record<string, string>;
  };
}

export type RollupState = "not_started" | "in_progress" | "pending" | "done";
export type LeafRole = "impl" | "unitTest" | "acceptance";

export interface RollupRules {
  doneStatuses?: string[];
  activeStatuses?: string[];
  pendingStatuses?: string[];
  ignoreStatuses?: string[];
}

export interface ProgressProfile {
  mode: "progress";
  note?: string;
  source: Side & {
    feature?: { epicPattern?: string; numberPattern?: string; summaryPattern?: string; milestone?: string };
    childGroups?: Record<string, string[]>;
    alwaysCount?: string[];
    rollup?: RollupRules;
  };
  dest: Side & {
    focusAssignee?: string;
    match?: { strategy?: string; pairFile?: string };
    write?: {
      comment?: boolean;
      dates?: string;
      allowRegress?: boolean;
      status?: Partial<Record<RollupState, string>>;
      neverTouchStatuses?: string[];
      targets?: LeafRole[];
      acceptanceOnlyWhenDone?: boolean;
      commentMarker?: string;
      orgName?: string;
    };
  };
  state?: string;
}

export type Profile = MirrorProfile | ProgressProfile;

export interface Config {
  defaultProfile?: string;
  spaces?: Record<string, SpaceSpec>;
  profiles?: Record<string, Profile>;
}

export interface RunContext<P extends Profile = Profile> {
  config: Config;
  profile: P;
  profileName: string;
}
