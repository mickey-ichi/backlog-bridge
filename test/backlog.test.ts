import { test } from "node:test";
import assert from "node:assert/strict";
import { BacklogClient } from "../src/backlog.ts";

function capture(t: import("node:test").TestContext, status = 200, body = "{}") {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(body, { status });
  });
  return calls;
}

const client = () => new BacklogClient({ space: "acme", apiKey: "SECRET" });

test("host: bare name -> .backlog.com, full host kept", () => {
  assert.equal(client().host, "acme.backlog.com");
  assert.equal(new BacklogClient({ space: "acme.backlog.jp", apiKey: "k" }).host, "acme.backlog.jp");
});

test("body: arrays get [] except customField_<id>, which repeats the bare key", async (t) => {
  const calls = capture(t);
  await client().createIssue({ projectId: 1, customField_7: [11, 12], customField_8: 5, categoryId: [3, 4], skip: undefined });
  assert.equal(
    String(calls[0].init.body),
    "projectId=1&customField_7=11&customField_7=12&customField_8=5&categoryId%5B%5D=3&categoryId%5B%5D=4",
  );
});

test("query: apiKey is sent as a parameter, arrays get []", async (t) => {
  const calls = capture(t, 200, "[]");
  await client().request("GET", "/issues", { params: { projectId: [1, 2], count: 5 } });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("apiKey"), "SECRET");
  assert.deepEqual(url.searchParams.getAll("projectId[]"), ["1", "2"]);
});

test("errors carry method, path and Backlog's message — never the API key", async (t) => {
  capture(t, 401, JSON.stringify({ errors: [{ message: "Authentication failure." }] }));
  await assert.rejects(client().getMyself(), (err: Error) => {
    assert.match(err.message, /GET \/users\/myself -> 401: Authentication failure\./);
    assert.doesNotMatch(err.message, /SECRET/);
    return true;
  });
});

test("getAllIssues: pages by 100 until a short page", async (t) => {
  const page = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i })));
  const sizes = [100, 100, 7];
  const offsets: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    offsets.push(new URL(String(url)).searchParams.get("offset")!);
    return new Response(page(sizes.shift()!), { status: 200 });
  });
  const all = await client().getAllIssues(1);
  assert.equal(all.length, 207);
  assert.deepEqual(offsets, ["0", "100", "200"]);
});

test("errors with a non-JSON body (HTML error page) are summarized, not dumped", async (t) => {
  capture(t, 500, "<!DOCTYPE html><html><head><title>Error</title></head><body>…</body></html>");
  await assert.rejects(client().getMyself(), (err: Error) => {
    assert.match(err.message, /GET \/users\/myself -> 500: .*non-JSON response/);
    assert.doesNotMatch(err.message, /DOCTYPE|<html/);
    return true;
  });
});

test("upload: multipart field 'file' with the file name, apiKey in the query", async (t) => {
  const calls = capture(t, 200, JSON.stringify({ id: 9, name: "a.png", size: 3 }));
  const res = await client().upload("a.png", new Uint8Array([1, 2, 3]));
  assert.equal(res.id, 9);
  assert.equal(new URL(calls[0].url).pathname, "/api/v2/space/attachment");
  const file = (calls[0].init.body as FormData).get("file") as File;
  assert.equal(file.name, "a.png");
  assert.equal(file.size, 3);
});

test("download: bytes and the UTF-8 file name from Content-Disposition", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([7, 8]), {
    headers: { "content-disposition": "attachment; filename=\"x.png\"; filename*=UTF-8''%E7%94%BB%E5%83%8F.png" },
  }));
  const { name, data } = await client().download("/issues/DEV-1/attachments/5");
  assert.equal(name, "画像.png");
  assert.deepEqual([...data], [7, 8]);
});

test("download: an error is reported like other calls, without the API key", async (t) => {
  capture(t, 404, JSON.stringify({ errors: [{ message: "No attachment." }] }));
  await assert.rejects(client().download("/issues/DEV-1/attachments/5"), (err: Error) => {
    assert.match(err.message, /GET \/issues\/DEV-1\/attachments\/5 -> 404: No attachment\./);
    assert.doesNotMatch(err.message, /SECRET/);
    return true;
  });
});
