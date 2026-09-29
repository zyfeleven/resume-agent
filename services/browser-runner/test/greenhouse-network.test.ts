import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type Route } from "playwright";
import { allowObservationRequest, greenhouseTarget, openRestrictedGreenhousePage } from "../src/greenhouse-observer.js";

const target = greenhouseTarget("fixture", "17");
const locale = `https://job-boards.cdn.greenhouse.io/locales/en/job_post.${"a".repeat(43)}.json`;
describe("bounded English presentation dictionaries", () => {
  it.each(["job_post", "common"])("permits only a versioned %s GET fetch", namespace => {
    expect(allowObservationRequest(target, locale.replace("job_post", namespace), "GET", "fetch")).toBe(true);
  });
  it.each([
    [locale, "POST", "fetch"], [locale, "GET", "script"], [locale, "GET", "document"], [locale, "GET", "xhr"],
    [locale + "?answer=PRIVATE", "GET", "fetch"], [locale + "#PRIVATE", "GET", "fetch"],
    [locale.replace("/en/", "/fr/"), "GET", "fetch"], [locale.replace("job_post", "profile"), "GET", "fetch"],
    [locale.replace("a".repeat(43), "latest"), "GET", "fetch"], [locale.replace(".json", ".js"), "GET", "fetch"],
    [locale.replace(".io/", ".io.evil.test/"), "GET", "fetch"], [locale.replace("https://", "https://user:pass@"), "GET", "fetch"],
  ])("refuses unapproved locale request %s %s %s", (url, method, type) => {
    expect(allowObservationRequest(target, url!, method!, type!)).toBe(false);
  });
  it("refuses redirects for a valid dictionary", () => expect(allowObservationRequest(target, locale, "GET", "fetch", true)).toBe(false));
});

describe("presentation response validation and one-way lock", () => {
  afterEach(() => vi.restoreAllMocks());
  async function fixture() {
    let intercept!: (route: any) => Promise<void>;
    const page = { on: vi.fn(), goto: vi.fn().mockResolvedValue({ ok: () => true }), url: () => target,
      evaluate: vi.fn().mockResolvedValue({ controls: [], signals: ["captcha_or_access_check"] }) };
    const context = { routeWebSocket: vi.fn(), setOffline: vi.fn(), route: vi.fn(async (_: unknown, handler: typeof intercept) => { intercept = handler; }), newPage: vi.fn().mockResolvedValue(page), on: vi.fn() };
    const browser = { newContext: vi.fn().mockResolvedValue(context), close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(chromium, "launch").mockResolvedValue(browser as unknown as Browser);
    const held = await openRestrictedGreenhousePage("fixture", "17");
    const response = { status: () => 200, headers: () => ({ "content-type": "application/json; charset=utf-8", "set-cookie": "PRIVATE_COOKIE" }),
      body: vi.fn().mockResolvedValue(Buffer.from('{"file_upload":{"attach":"Attach"}}')), dispose: vi.fn().mockResolvedValue(undefined) };
    const route = { request: () => ({ url: () => locale, method: () => "GET", resourceType: () => "fetch", redirectedFrom: () => null, isNavigationRequest: () => false }),
      fetch: vi.fn().mockResolvedValue(response), fulfill: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
    return { held, response, route, intercept };
  }
  it("delivers an object dictionary without cookies or write capability", async () => {
    const f = await fixture();
    try {
      await f.intercept(f.route);
      expect(f.route.fulfill).toHaveBeenCalledOnce();
      expect(f.route.fulfill.mock.calls[0]![0]).toMatchObject({ status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
      expect(JSON.stringify(f.route.fulfill.mock.calls)).not.toContain("PRIVATE_COOKIE");
      expect(f.response.dispose).toHaveBeenCalledOnce();
      expect(await f.held.snapshot()).toMatchObject({ canFill: false, canSubmit: false, signals: ["captcha_or_access_check"] });
    } finally { await f.held.close(); }
  });
  it.each(["html", "malformed", "array", "null", "scalar", "status", "oversized", "declared_oversized", "redirect", "fetch_error"])("refuses %s and marks the view incomplete", async kind => {
    const f = await fixture();
    try {
      if (kind === "html") f.response.headers = () => ({ "content-type": "text/html", "set-cookie": "PRIVATE_COOKIE" });
      if (kind === "status" || kind === "redirect") f.response.status = () => kind === "status" ? 404 : 302;
      if (kind === "declared_oversized") f.response.headers = () => ({ "content-type": "application/json", "set-cookie": "PRIVATE_COOKIE", "content-length": "128001" });
      const bodies: Record<string, string> = { malformed: '{PRIVATE', array: '[]', null: 'null', scalar: '"PRIVATE"', oversized: JSON.stringify({ text: "x".repeat(128_000) }) };
      if (kind in bodies) f.response.body.mockResolvedValue(Buffer.from(bodies[kind]!));
      if (kind === "fetch_error") f.route.fetch.mockRejectedValue(new Error("PRIVATE_URL"));
      await f.intercept(f.route);
      expect(f.route.fulfill).not.toHaveBeenCalled(); expect(f.route.abort).toHaveBeenCalledOnce();
      const result = await f.held.snapshot();
      expect(result.signals).toContain("presentation_assets_incomplete"); expect(JSON.stringify(result)).not.toContain("PRIVATE");
      if (kind !== "fetch_error") expect(f.response.dispose).toHaveBeenCalledOnce();
    } finally { await f.held.close(); }
  });
  it.each(["fetch", "body"])("discards a %s response that completes after network freeze", async stage => {
    const f = await fixture(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    if (stage === "fetch") f.route.fetch.mockImplementation(async () => { await pending; return f.response; });
    else f.response.body.mockImplementation(async () => { await pending; return Buffer.from('{}'); });
    try {
      const request = f.intercept(f.route);
      await vi.waitFor(() => expect(stage === "fetch" ? f.route.fetch : f.response.body).toHaveBeenCalledOnce());
      expect((await f.held.snapshot()).signals).toContain("presentation_assets_incomplete");
      await f.held.freezeNetwork(); release(); await request;
      expect(f.route.fulfill).not.toHaveBeenCalled(); expect(f.route.abort).toHaveBeenCalledOnce(); expect(f.response.dispose).toHaveBeenCalledOnce();
      expect((await f.held.snapshot()).signals).toContain("presentation_assets_incomplete");
    } finally { release(); await f.held.close(); }
  });
  it("never starts a dictionary fetch after freezing", async () => {
    const f = await fixture();
    try { await f.held.freezeNetwork(); await f.intercept(f.route); expect(f.route.fetch).not.toHaveBeenCalled(); expect(f.route.abort).toHaveBeenCalledOnce(); }
    finally { await f.held.close(); }
  });
});

describe("offline Chromium initialization regression", () => {
  afterEach(() => vi.restoreAllMocks());
  it("loads both dictionaries before initialization and reports the resulting access-check dependency", async () => {
    const browser = await chromium.launch({ headless: true });
    const newContext = browser.newContext.bind(browser);
    const fetched: string[] = []; const blocked: string[] = [];
    const common = locale.replace("job_post", "common");
    // The actual production interceptor runs, but its HTTP fetch is replaced with local bytes.
    // No fixture request can reach an employer or any other network endpoint.
    vi.spyOn(browser, "newContext").mockImplementation(async options => {
      const context = await newContext(options); const installRoute = context.route.bind(context);
      vi.spyOn(context, "route").mockImplementation(async (pattern, handler, options) => {
        return installRoute(pattern, async (route, request) => {
          const wrapped = new Proxy(route, {
            get(original, key) {
              if (key === "fetch") return async () => {
                const url = request.url(); fetched.push(url);
                const body = url === target ? `<label>Project<textarea></textarea></label><script>
                  fetch(${JSON.stringify(locale)}).then(r=>r.json()).then(()=>fetch(${JSON.stringify(common)})).then(r=>r.json()).then(()=>{
                    const s=document.createElement('script');s.src='https://www.recaptcha.net/recaptcha/enterprise.js?render=PUBLIC';document.head.append(s);
                  });</script>` : '{"label":"LOCAL_FIXTURE"}';
                return { status: () => 200, headers: () => ({ "content-type": url === target ? "text/html" : "application/json" }), body: async () => Buffer.from(body), dispose: async () => undefined };
              };
              if (key === "abort") return async () => { blocked.push(request.url()); await route.abort(); };
              const value = Reflect.get(original, key); return typeof value === "function" ? value.bind(original) : value;
            },
          }) as Route;
          await handler(wrapped, request);
        }, options);
      });
      return context;
    });
    vi.spyOn(chromium, "launch").mockResolvedValue(browser);
    try {
      const held = await openRestrictedGreenhousePage("fixture", "17");
      try {
        expect(fetched).toEqual([target, locale, common]);
        expect(blocked).toContain("https://www.recaptcha.net/recaptcha/enterprise.js?render=PUBLIC");
        expect(held.initial.signals).toContain("captcha_or_access_check");
        expect(held.initial.signals).not.toContain("presentation_assets_incomplete");
        expect(held.initial).toMatchObject({ canFill: false, canSubmit: false });
      } finally { await held.close(); }
    } finally { await browser.close(); }
  }, 15000); // Includes Chromium startup under full-workspace test load; assertions stay unchanged.
});
