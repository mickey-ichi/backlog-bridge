export class BacklogClient {
    host;
    apiKey;
    base;
    /**
     * @param opts.space   e.g. "acme" or full host "acme.backlog.com" / "acme.backlog.jp"
     * @param opts.apiKey  Backlog API key
     */
    constructor({ space, apiKey }) {
        if (!space)
            throw new Error("Backlog space is required");
        if (!apiKey)
            throw new Error("Backlog apiKey is required");
        // Accept either a bare space name or a full host.
        this.host = space.includes(".") ? space : `${space}.backlog.com`;
        this.apiKey = apiKey;
        this.base = `https://${this.host}/api/v2`;
    }
    #url(path, params = {}) {
        const url = new URL(`${this.base}${path}`);
        url.searchParams.set("apiKey", this.apiKey);
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null)
                continue;
            if (Array.isArray(v))
                v.forEach((item) => url.searchParams.append(`${k}[]`, String(item)));
            else
                url.searchParams.set(k, String(v));
        }
        return url;
    }
    async #request(method, path, { params = {}, body } = {}) {
        const url = this.#url(path, params);
        const init = { method };
        if (body) {
            const form = new URLSearchParams();
            for (const [k, v] of Object.entries(body)) {
                if (v === undefined || v === null)
                    continue;
                // Multi-value customField_<id>: Backlog wants the exact key repeated; sending "customField_<id>[]"
                // still makes the API report "... is required". Other arrays keep the "[]" suffix per the docs.
                const name = k.startsWith("customField_") ? k : `${k}[]`;
                if (Array.isArray(v))
                    v.forEach((item) => form.append(name, String(item)));
                else
                    form.append(k, String(v));
            }
            init.body = form;
            init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
        }
        const res = await fetch(url, init);
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch { /* keep raw */ }
        if (!res.ok) {
            // Non-JSON bodies (HTML error pages for a wrong space name, proxies, ...) are summarized, never dumped.
            const msg = data?.errors?.map((e) => e.message).join("; ")
                || (data === null && text ? `${res.statusText || "error"} (non-JSON response — check the space name)` : text)
                || res.statusText;
            throw new Error(`Backlog ${method} ${path} -> ${res.status}: ${msg}`);
        }
        return data;
    }
    // Generic escape hatch for the multi-space CLI (src/bl.ts) — call any API v2 endpoint.
    request(method, path, opts) {
        return this.#request(method, path, opts);
    }
    // --- Reads ---
    getProject(projectIdOrKey) {
        return this.#request("GET", `/projects/${projectIdOrKey}`);
    }
    getStatuses(projectIdOrKey) {
        return this.#request("GET", `/projects/${projectIdOrKey}/statuses`);
    }
    getIssueTypes(projectIdOrKey) {
        return this.#request("GET", `/projects/${projectIdOrKey}/issueTypes`);
    }
    getPriorities() {
        return this.#request("GET", `/priorities`);
    }
    getProjectUsers(projectIdOrKey) {
        return this.#request("GET", `/projects/${projectIdOrKey}/users`);
    }
    getMyself() {
        return this.#request("GET", `/users/myself`);
    }
    getIssue(issueIdOrKey) {
        return this.#request("GET", `/issues/${issueIdOrKey}`);
    }
    getCategories(projectIdOrKey) {
        return this.#request("GET", `/projects/${projectIdOrKey}/categories`);
    }
    getVersions(projectIdOrKey) {
        return this.#request("GET", `/projects/${projectIdOrKey}/versions`);
    }
    getCustomFields(projectIdOrKey) {
        return this.#request("GET", `/projects/${projectIdOrKey}/customFields`);
    }
    // Newest comments first (order=desc) — used to find previously posted progress comments.
    getComments(issueIdOrKey, { count = 100, order = "desc" } = {}) {
        return this.#request("GET", `/issues/${issueIdOrKey}/comments`, { params: { count, order } });
    }
    /**
     * Fetch all issues of a project, auto-paginating.
     * @param updatedSince YYYY-MM-DD
     */
    async getAllIssues(projectId, updatedSince) {
        const all = [];
        const pageSize = 100;
        let offset = 0;
        for (;;) {
            const page = await this.#request("GET", "/issues", {
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
            if (page.length < pageSize)
                break;
            offset += pageSize;
        }
        return all;
    }
    // --- Writes ---
    createIssue(fields) {
        // required: projectId, summary, issueTypeId, priorityId
        return this.#request("POST", "/issues", { body: fields });
    }
    updateIssue(issueIdOrKey, fields) {
        return this.#request("PATCH", `/issues/${issueIdOrKey}`, { body: fields });
    }
    addComment(issueIdOrKey, content) {
        return this.#request("POST", `/issues/${issueIdOrKey}/comments`, { body: { content } });
    }
    updateComment(issueIdOrKey, commentId, content) {
        return this.#request("PATCH", `/issues/${issueIdOrKey}/comments/${commentId}`, { body: { content } });
    }
}
