// Backlog REST API v2 client (zero dependency, Node global fetch)
// Docs: https://developer.nulab.com/docs/backlog/
import type {
  Comment, Credentials, CustomField, Issue, Named, Params, Project, Status, User,
} from "./types.ts";

export interface RequestOptions {
  params?: Params;
  body?: Params;
}

export class BacklogClient {
  readonly host: string;
  readonly apiKey: string;
  readonly base: string;

  /**
   * @param opts.space   e.g. "acme" or full host "acme.backlog.com" / "acme.backlog.jp"
   * @param opts.apiKey  Backlog API key
   */
  constructor({ space, apiKey }: Credentials) {
    if (!space) throw new Error("Backlog space is required");
    if (!apiKey) throw new Error("Backlog apiKey is required");
    // Accept either a bare space name or a full host.
    this.host = space.includes(".") ? space : `${space}.backlog.com`;
    this.apiKey = apiKey;
    this.base = `https://${this.host}/api/v2`;
  }

  #url(path: string, params: Params = {}): URL {
    const url = new URL(`${this.base}${path}`);
    url.searchParams.set("apiKey", this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(`${k}[]`, String(item)));
      else url.searchParams.set(k, String(v));
    }
    return url;
  }

  async #request<T>(method: string, path: string, { params = {}, body }: RequestOptions = {}): Promise<T> {
    const url = this.#url(path, params);
    const init: RequestInit = { method };
    if (body) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined || v === null) continue;
        // Multi-value customField_<id>: Backlog wants the exact key repeated; sending "customField_<id>[]"
        // still makes the API report "... is required". Other arrays keep the "[]" suffix per the docs.
        const name = k.startsWith("customField_") ? k : `${k}[]`;
        if (Array.isArray(v)) v.forEach((item) => form.append(name, String(item)));
        else form.append(k, String(v));
      }
      init.body = form;
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    if (!res.ok) {
      // Non-JSON bodies (HTML error pages for a wrong space name, proxies, ...) are summarized, never dumped.
      const msg = data?.errors?.map((e: { message: string }) => e.message).join("; ")
        || (data === null && text ? `${res.statusText || "error"} (non-JSON response — check the space name)` : text)
        || res.statusText;
      throw new Error(`Backlog ${method} ${path} -> ${res.status}: ${msg}`);
    }
    return data as T;
  }

  // Generic escape hatch for the multi-space CLI (src/cli.ts) — call any API v2 endpoint.
  request<T = any>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    return this.#request<T>(method, path, opts);
  }

  // --- Reads ---
  getProject(projectIdOrKey: number | string) {
    return this.#request<Project>("GET", `/projects/${projectIdOrKey}`);
  }
  getStatuses(projectIdOrKey: number | string) {
    return this.#request<Status[]>("GET", `/projects/${projectIdOrKey}/statuses`);
  }
  getIssueTypes(projectIdOrKey: number | string) {
    return this.#request<Named[]>("GET", `/projects/${projectIdOrKey}/issueTypes`);
  }
  getPriorities() {
    return this.#request<Named[]>("GET", `/priorities`);
  }
  getProjectUsers(projectIdOrKey: number | string) {
    return this.#request<User[]>("GET", `/projects/${projectIdOrKey}/users`);
  }

  getMyself() {
    return this.#request<User>("GET", `/users/myself`);
  }
  getIssue(issueIdOrKey: number | string) {
    return this.#request<Issue>("GET", `/issues/${issueIdOrKey}`);
  }
  getCategories(projectIdOrKey: number | string) {
    return this.#request<Named[]>("GET", `/projects/${projectIdOrKey}/categories`);
  }
  getVersions(projectIdOrKey: number | string) {
    return this.#request<Named[]>("GET", `/projects/${projectIdOrKey}/versions`);
  }
  getCustomFields(projectIdOrKey: number | string) {
    return this.#request<CustomField[]>("GET", `/projects/${projectIdOrKey}/customFields`);
  }
  // Newest comments first (order=desc) — used to find previously posted progress comments.
  getComments(issueIdOrKey: number | string, { count = 100, order = "desc" } = {}) {
    return this.#request<Comment[]>("GET", `/issues/${issueIdOrKey}/comments`, { params: { count, order } });
  }

  /**
   * Fetch all issues of a project, auto-paginating.
   * @param updatedSince YYYY-MM-DD
   */
  async getAllIssues(projectId: number, updatedSince?: string): Promise<Issue[]> {
    const all: Issue[] = [];
    const pageSize = 100;
    let offset = 0;
    for (;;) {
      const page = await this.#request<Issue[]>("GET", "/issues", {
        params: {
          projectId: [projectId],
          count: pageSize,
          offset,
          sort: "updated",
          order: "asc",
          updatedSince,
        },
      });
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  }

  // --- Writes ---
  createIssue(fields: Params) {
    // required: projectId, summary, issueTypeId, priorityId
    return this.#request<Issue>("POST", "/issues", { body: fields });
  }
  updateIssue(issueIdOrKey: number | string, fields: Params) {
    return this.#request<Issue>("PATCH", `/issues/${issueIdOrKey}`, { body: fields });
  }
  addComment(issueIdOrKey: number | string, content: string) {
    return this.#request<Comment>("POST", `/issues/${issueIdOrKey}/comments`, { body: { content } });
  }
  updateComment(issueIdOrKey: number | string, commentId: number, content: string) {
    return this.#request<Comment>("PATCH", `/issues/${issueIdOrKey}/comments/${commentId}`, { body: { content } });
  }
}
