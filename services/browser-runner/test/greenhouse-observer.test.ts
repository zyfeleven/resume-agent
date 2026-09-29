import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { allowObservationRequest, greenhouseTarget, labelledResumePicker, observeGreenhousePage, openRestrictedGreenhousePage, readGreenhouseDom } from "../src/greenhouse-observer.js";

const target = greenhouseTarget("Fixture", "17");
describe("read-only Greenhouse request boundaries", () => {
  it("constructs the exact canonical identity", () => expect(target).toBe("https://job-boards.greenhouse.io/fixture/jobs/17"));
  it.each([["../private", "17"], ["fixture", "17?secret=1"], ["fixture", "-1"], ["", "17"]])("refuses malformed identity %s %s", (board, id) => expect(() => greenhouseTarget(board!, id!)).toThrow());
  it("allows only the exact document and fixed public presentation assets", () => {
    expect(allowObservationRequest(target, target, "GET", "document")).toBe(true);
    expect(allowObservationRequest(target, "https://job-boards.cdn.greenhouse.io/assets/entry-Ab1.js", "GET", "script")).toBe(true);
    expect(allowObservationRequest(target, "https://job-boards.cdn.greenhouse.io/assets/entry-Ab1.css", "GET", "stylesheet")).toBe(true);
  });
  it.each([
    [target, "POST", "document"], [target, "GET", "fetch"], [target + "?answer=secret", "GET", "document"],
    [target + "/apply", "GET", "document"], ["http://127.0.0.1/private", "GET", "document"],
    ["https://job-boards.greenhouse.io.evil.test/fixture/jobs/17", "GET", "document"],
    ["https://user:pass@job-boards.greenhouse.io/fixture/jobs/17", "GET", "document"],
    ["https://job-boards.cdn.greenhouse.io/assets/entry.js?data=secret", "GET", "script"],
    ["https://job-boards.cdn.greenhouse.io/api/submit", "GET", "script"],
    ["https://www.google.com/recaptcha/api.js", "GET", "script"],
  ])("blocks %s %s %s", (url, method, type) => expect(allowObservationRequest(target, url!, method!, type!)).toBe(false));
  it("refuses even same-target redirects", () => expect(allowObservationRequest(target, target, "GET", "document", true)).toBe(false));
});

describe("actual Chromium DOM extraction with offline HTML", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });
  async function read(html: string) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => route.abort());
    try { const page = await context.newPage(); await page.setContent(html); return await readGreenhouseDom(page); }
    finally { await context.close(); }
  }
  it("extracts labels/required/visibility without values or selected state", async () => {
    const result = await read('<label for="first_name">First name *</label><input id="first_name" name="job_application[first_name]" required value="SECRET_PERSON"><label>Project<textarea id="project">SECRET_STORY</textarea></label><input type="hidden" value="SECRET_TOKEN"><select aria-label="Choice"><option value="SECRET_OPTION" selected>Yes</option><option>No</option></select>');
    expect(result.controls[0]).toMatchObject({ label: "First name *", name: "job_application[first_name]", required: true, visible: true, type: "text" });
    expect(result.controls[1]!.label).toBe("Project");
    expect(result.controls[2]!.visible).toBe(false);
    expect(result.controls[3]!.optionLabels).toEqual(["Yes", "No"]);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|selected|checked|value/);
  });
  it("combines aria-labelled-by labels and detects custom controls", async () => {
    const result = await read('<span id="a">Work</span><span id="b">location</span><input role="combobox" aria-labelledby="a b" aria-required="true" aria-disabled="true">');
    expect(result.controls[0]).toMatchObject({ label: "Work location", required: true, disabled: true });
    expect(result.signals).toContain("custom_controls_need_review");
  });
  it.each([
    ['<input type="password">', "login_or_mfa"], ['<input autocomplete="one-time-code">', "login_or_mfa"],
    ['<div id="g-recaptcha"></div>', "captcha_or_access_check"], ['<iframe src="https://example.invalid/form"></iframe>', "unobserved_frames"],
    ['<script src="https://www.recaptcha.net/recaptcha/enterprise.js?render=PUBLIC"></script><input>', "captcha_or_access_check"],
    ['<script src="https://js.hcaptcha.com/1/api.js"></script><input>', "captcha_or_access_check"],
    ['<h1>This position has been filled</h1>', "posting_unavailable"], ['<h1>Loading</h1>', "no_visible_form"],
    ['<p>' + 'Long JD. '.repeat(300) + '</p><p>Verify you are human</p>', "captcha_or_access_check"],
  ])("reports manual conditions without interacting: %s", async (html, signal) => expect((await read(html!)).signals).toContain(signal));
  it("bounds control output", async () => { const result = await read('<input>'.repeat(301)); expect(result.controls).toHaveLength(300); expect(result.signals).toContain("control_limit"); });
  it.each([
    'position:absolute;width:1px;height:1px;clip:rect(0,0,0,0)',
    'clip-path:inset(50%)', 'opacity:0', 'visibility:collapse', 'display:none',
    'content-visibility:hidden', 'height:0;overflow:hidden',
  ])("does not mistake hidden or clipped upload controls for visible ones: %s", async style => {
    const result = await read(`<div style="${style}"><label for="resume">Attach</label><input id="resume" type="file"></div>`);
    expect(result.controls[0]!.visible).toBe(false);
  });
  it("extracts distinct explicit file groups and dormant alternative references without candidate values", async () => {
    const result = await read('<span id="r">Resume/CV<input value="SECRET"></span><div role="group" aria-labelledby="r"><label for="resume">Attach</label><input id="resume" type="file" accept=".pdf, .docx"><label for="resume_text">Enter manually</label></div><fieldset><legend>Cover letter</legend><label for="cover_letter">Attach</label><input id="cover_letter" type="file" multiple webkitdirectory></fieldset>');
    const resume = result.controls.find(c => c.id === "resume")!;
    expect(resume).toMatchObject({ label: "Attach", visible: true, upload: { accept: [".pdf", ".docx"], multiple: false, directory: false, group: { label: "Resume/CV", labelStatus: "explicit", fieldIds: ["resume"], triggerTargets: ["resume", "resume_text"] } } });
    expect(result.controls.find(c => c.id === "cover_letter")!.upload).toMatchObject({ multiple: true, directory: true, group: { label: "Cover letter", labelStatus: "explicit" } });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|selected|checked|value/);
    expect(result.controls.some(c => c.id === "resume_text")).toBe(false);
  });
  it.each([
    ['<span id="title">Resume</span><span id="title">Cover letter</span>', 'title', 'ambiguous'],
    ['<span id="title">Resume</span>', 'title title', 'ambiguous'],
    ['<span id="title">Resume</span>', 'title missing', 'missing'],
    ['', 'missing', 'missing'],
  ])("does not guess invalid group label references", async (html, ids, status) => {
    const result = await read(`${html}<div role="group" aria-labelledby="${ids}"><input id="resume" type="file"></div>`);
    expect(result.controls[0]!.upload!.group).toMatchObject({ label: "", labelStatus: status });
  });
  it("uses the nearest group only and does not invent labels from nearby text", async () => {
    const result = await read('<fieldset><legend>Outer</legend><div role="group"><h3>Resume</h3><label for="resume">Attach</label><input id="resume" type="file"></div><label for="other">Other</label><input id="other" type="file"></fieldset>');
    expect(result.controls[0]!.upload!.group).toEqual({ label: "", labelStatus: "missing", fieldIds: ["resume"], triggerTargets: ["resume"] });
    expect(result.controls[1]!.upload!.group).toEqual({ label: "Outer", labelStatus: "explicit", fieldIds: ["other"], triggerTargets: ["other"] });
  });
  it("captures disabled fieldsets and bounds group metadata", async () => {
    const result = await read('<fieldset disabled aria-label="Resume"><input id="resume" type="file">' + '<label for="resume_text">Enter manually</label>'.repeat(101) + '</fieldset>');
    expect(result.controls[0]!.disabled).toBe(true);
    expect(result.controls[0]!.upload!.group!.triggerTargets).toHaveLength(100);
  });
  it("retains no group for a standalone file and no upload metadata for ordinary text", async () => {
    const result = await read('<label for="resume">Resume</label><input id="resume" type="file"><textarea aria-label="Project">SECRET_STORY</textarea>');
    expect(result.controls[0]!.upload!.group).toBeNull();
    expect(result.controls[1]!.upload).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("SECRET_STORY");
  });
  it("does not read values when an accessible label directly references an editable element", async () => {
    const result = await read('<textarea id="private">SECRET_RESUME</textarea><div role="group" aria-labelledby="private"><input id="resume" type="file" aria-labelledby="private"></div>');
    expect(result.controls[1]!.label).toBe("");
    expect(result.controls[1]!.upload!.group).toMatchObject({ label: "", labelStatus: "missing" });
    expect(JSON.stringify(result)).not.toContain("SECRET_RESUME");
  });
  it("recognizes only a uniquely associated visible native label with mounted alternatives", async () => {
    const result = await read('<div role="group" aria-label="Resume"><label for="resume">Attach</label><input id="resume" type="file" hidden><label for="resume_text">Resume</label><textarea id="resume_text">SECRET</textarea></div>');
    expect(result.controls[0]!.upload!.trigger).toEqual({ forId: 'resume', label: 'Attach', visible: true, associated: true });
    expect(labelledResumePicker(result.controls[0]!)).toEqual({ forId: 'resume', label: 'Attach', groupLabel: 'Resume' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it.each(['duplicate', 'outside', 'button', 'unmounted'])("does not infer a picker from %s evidence", async kind => {
    const result = await read(`${kind === 'outside' ? '<label for="resume">Attach</label>' : ''}<div role="group" aria-label="Resume">${kind === 'outside' ? '' : kind === 'button' ? '<button>Attach</button>' : '<label for="resume">Attach</label>'}${kind === 'duplicate' ? '<label for="resume">Attach</label>' : ''}<input id="resume" type="file" hidden>${kind === 'unmounted' ? '<label for="resume_text">Enter manually</label>' : '<textarea id="resume_text"></textarea>'}</div>`);
    expect(labelledResumePicker(result.controls.find(c => c.id === 'resume')!)).toBeUndefined();
  });
});

describe("browser lifecycle and network interception", () => {
  afterEach(() => vi.restoreAllMocks());
  it("freezes even previously allowed GETs before candidate data can enter the page", async () => {
    const page = { on: vi.fn(), goto: vi.fn().mockResolvedValue({ ok: () => true }), url: () => target, isClosed: () => false,
      evaluate: vi.fn().mockResolvedValue({ controls: [], signals: ["captcha_or_access_check"] }) };
    let intercept!: (route: any) => Promise<void>;
    const context = { routeWebSocket: vi.fn(), setOffline: vi.fn(), route: vi.fn(async (_: unknown, handler: typeof intercept) => { intercept = handler; }), newPage: vi.fn().mockResolvedValue(page), on: vi.fn() };
    const browser = { newContext: vi.fn().mockResolvedValue(context), close: vi.fn(), isConnected: () => true };
    vi.spyOn(chromium, "launch").mockResolvedValue(browser as unknown as Browser);
    const held = await openRestrictedGreenhousePage("fixture", "17", true, 600000);
    try {
      await held.freezeNetwork(); expect(context.setOffline).toHaveBeenCalledWith(true);
      const request = { request: () => ({ url: () => target, method: () => "GET", resourceType: () => "document", redirectedFrom: () => null }), abort: vi.fn(), fetch: vi.fn() };
      await intercept(request); expect(request.abort).toHaveBeenCalled(); expect(request.fetch).not.toHaveBeenCalled();
      expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false }));
    } finally { browser.close.mockResolvedValue(undefined); await held.close(); }
  });
  it("passes the snapshot policy with current origin and closes after a successful read", async () => {
    const page = { on: vi.fn(), goto: vi.fn().mockResolvedValue({ ok: () => true }), url: () => target,
      evaluate: vi.fn().mockResolvedValue({ controls: [], signals: ["captcha_or_access_check"] }) };
    let intercept!: (route: any) => Promise<void>;
    const context = { routeWebSocket: vi.fn(), route: vi.fn(async (_: unknown, handler: typeof intercept) => { intercept = handler; }), newPage: vi.fn().mockResolvedValue(page), on: vi.fn() };
    const browser = { newContext: vi.fn().mockResolvedValue(context), close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(chromium, "launch").mockResolvedValue(browser as unknown as Browser);
    const result = await observeGreenhousePage("fixture", "17");
    expect(result).toMatchObject({ url: target, canFill: false, canSubmit: false, signals: ["captcha_or_access_check"] });
    // No second read or interactions once an access check is detected.
    expect(page.evaluate).toHaveBeenCalledTimes(1); expect(browser.close).toHaveBeenCalledTimes(1);
    const dangerous = { request: () => ({ url: () => target, method: () => "POST", resourceType: () => "document", redirectedFrom: () => null }), abort: vi.fn(), fetch: vi.fn() };
    await intercept(dangerous); expect(dangerous.abort).toHaveBeenCalled(); expect(dangerous.fetch).not.toHaveBeenCalled();
    const redirectedResponse = { status: () => 302, headers: () => ({}), dispose: vi.fn() };
    const redirected = { request: () => ({ url: () => target, method: () => "GET", resourceType: () => "document", redirectedFrom: () => null, isNavigationRequest: () => true, frame: () => ({ parentFrame: () => null }) }), abort: vi.fn(), fetch: vi.fn().mockResolvedValue(redirectedResponse) };
    await intercept(redirected);
    expect(redirected.fetch).toHaveBeenCalledWith(expect.objectContaining({ maxRedirects: 0, maxRetries: 0 }));
    expect(redirected.abort).toHaveBeenCalled();
  });
  it("always closes an ephemeral browser when navigation fails and redacts browser errors", async () => {
    const page = { on: vi.fn(), goto: vi.fn().mockRejectedValue(new Error("SECRET_URL_OR_COOKIE")) };
    const context = { routeWebSocket: vi.fn(), route: vi.fn(), newPage: vi.fn().mockResolvedValue(page), on: vi.fn() };
    const browser = { newContext: vi.fn().mockResolvedValue(context), close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(chromium, "launch").mockResolvedValue(browser as unknown as Browser);
    await expect(observeGreenhousePage("fixture", "17")).rejects.toThrow(/could not finish safely/);
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ serviceWorkers: "block", acceptDownloads: false, permissions: [] }));
    expect(context.routeWebSocket).toHaveBeenCalled(); expect(context.route).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
  it("rejects concurrent observations and releases the lock after failure", async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(chromium, "launch").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const pending = observeGreenhousePage("fixture", "17");
    await expect(observeGreenhousePage("fixture", "17")).rejects.toThrow(/already running/);
    reject(new Error("launch failure")); await expect(pending).rejects.toThrow(/safely/);
  });
});
