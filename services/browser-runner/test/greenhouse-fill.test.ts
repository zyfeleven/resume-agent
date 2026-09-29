import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { GreenhouseTextSession, greenhouseEvidenceHash, type NarrativeWrite, type ResumeAttachment } from "../src/greenhouse-fill.js";
import { readGreenhouseDom, labelledResumePicker, type GreenhouseDomSnapshot } from "../src/greenhouse-observer.js";

describe("supervised narrative writes in actual Chromium (offline fixtures only)", () => {
  let browser: Browser; let context: BrowserContext; let page: Page; let session: GreenhouseTextSession; let row: NarrativeWrite;
  let file: ResumeAttachment;
  let refreshEvidence: () => Promise<GreenhouseDomSnapshot>;
  const url = "https://job-boards.greenhouse.io/fixture/jobs/17";
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });
  beforeEach(async () => {
    context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => route.request().url() === url && route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: '<label for="q">Describe a project</label><textarea id="q" name="question_1"></textarea><label for="resume">Resume</label><input id="resume" name="resume" type="file" accept=".docx">' }) : route.abort());
    page = await context.newPage(); await page.goto(url);
    const snapshot = async (): Promise<GreenhouseDomSnapshot> => {
      const raw = await readGreenhouseDom(page);
      return { ...raw, url, observedAt: new Date().toISOString(), structureHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"), blockedRequests: 0, canFill: false, canSubmit: false };
    };
    refreshEvidence = async () => {
      const initial = await snapshot();
      session = new GreenhouseTextSession({ page, initial, snapshot, close: () => context.close(), get alive() { return !page.isClosed(); }, freezeNetwork: () => context.setOffline(true) }, greenhouseEvidenceHash(initial));
      return initial;
    };
    const initial = await refreshEvidence();
    row = { questionId: "q1", text: "Built Python tools.", factIds: ["fact:project"], target: { ...initial.controls[0]! } };
    const buffer = Buffer.from("SIMULATED BYTE TRANSFER ONLY; DOCUMENT GATES TESTED SEPARATELY");
    file = { target: { ...initial.controls[1]! }, buffer, outputHash: createHash("sha256").update(buffer).digest("hex"), fileName: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  });
  afterEach(async () => { await context?.close(); });
  async function grouped(hidden = false) {
    await page.evaluate(isHidden => document.body.insertAdjacentHTML("beforeend", `<label for="resume_text">Resume</label><textarea id="resume_text" name="resume_text" ${isHidden ? "hidden" : ""}></textarea>`), hidden);
    const snapshot = await refreshEvidence(); file.target.alternative = { ...snapshot.controls[2]! };
    await session.freezeNetwork();
  }
  async function pickerFixture() {
    await page.evaluate(() => {
      document.querySelector('label[for="resume"]')!.remove(); document.querySelector('#resume')!.remove();
      document.body.insertAdjacentHTML('beforeend', '<div role="group" aria-label="Resume"><label for="resume">Attach</label><input id="resume" type="file" style="clip-path:inset(50%)" accept=".docx"><label for="resume_text">Resume</label><textarea id="resume_text"></textarea></div>');
    });
    const snapshot = await refreshEvidence();
    file.target = { ...snapshot.controls[1]!, alternative: { ...snapshot.controls[2]! }, picker: labelledResumePicker(snapshot.controls[1]!) };
    await session.freezeNetwork();
  }
  it("attaches through the confirmed label association without clicking or changing hidden styles", async () => {
    await pickerFixture();
    await page.locator('label[for="resume"]').evaluate(el => el.addEventListener('click', () => el.setAttribute('data-clicked', 'yes')));
    const result = await session.attachResume(file, true);
    expect(result.outputHash).toBe(file.outputHash);
    expect(await page.locator('#resume').getAttribute('style')).toBe('clip-path:inset(50%)');
    expect(await page.locator('label[for="resume"]').getAttribute('data-clicked')).toBeNull();
    expect(await page.locator('#resume_text').inputValue()).toBe('');
    await expect(session.attachResume(file, true)).rejects.toThrow(/scope/);
  });
  it.each(['scope', 'forged_group', 'forged_label', 'alternative_scope'])("refuses an absent or forged picker scope: %s", async kind => {
    await pickerFixture();
    if (kind === 'scope') delete file.target.picker;
    if (kind === 'forged_group') file.target.picker!.groupLabel = 'Cover Letter';
    if (kind === 'forged_label') file.target.picker!.label = 'Upload';
    if (kind === 'alternative_scope') delete file.target.alternative;
    await expect(session.attachResume(file, true)).rejects.toThrow();
    expect(await page.locator('#resume').evaluate(el => (el as HTMLInputElement).files!.length)).toBe(0);
  });
  it.each(['duplicate_label', 'hidden_label', 'cover_letter', 'missing_alternative', 'wrong_for'])("refuses unsupported picker structures even with fresh evidence: %s", async kind => {
    await pickerFixture();
    await page.evaluate(reason => {
      const label = document.querySelector('label[for="resume"]')!;
      if (reason === 'duplicate_label') label.after(label.cloneNode(true));
      if (reason === 'hidden_label') label.setAttribute('hidden', '');
      if (reason === 'cover_letter') document.querySelector('[role="group"]')!.setAttribute('aria-label', 'Cover Letter');
      if (reason === 'missing_alternative') document.querySelector('#resume_text')!.remove();
      if (reason === 'wrong_for') label.setAttribute('for', 'resume_text');
    }, kind);
    await refreshEvidence(); await session.freezeNetwork();
    await expect(session.attachResume(file, true)).rejects.toThrow();
    expect(await page.locator('#resume').evaluate(el => (el as HTMLInputElement).files!.length)).toBe(0);
  });
  it("preserves an occupied text alternative for a labelled picker", async () => {
    await pickerFixture(); await page.locator('#resume_text').fill('Existing resume');
    await expect(session.attachResume(file, true)).rejects.toThrow(/nonempty/);
    expect(await page.locator('#resume_text').inputValue()).toBe('Existing resume');
    expect(await page.locator('#resume').evaluate(el => (el as HTMLInputElement).files!.length)).toBe(0);
  });
  it("stops without replay after a picker file event changes group ownership", async () => {
    await pickerFixture(); await page.locator('#resume').evaluate(el => el.addEventListener('change', () => el.closest('[role="group"]')!.setAttribute('aria-label', 'Cover Letter')));
    await expect(session.attachResume(file, true)).rejects.toThrow(/stopped/);
    await expect(session.attachResume(file, true)).rejects.toThrow(/scope/);
  });
  it.each([false, true])("selects the file branch with an empty observed alternative (hidden=%s)", async hidden => {
    await grouped(hidden); const result = await session.attachResume(file, true);
    expect(result.outputHash).toBe(file.outputHash);
    expect(await page.locator("#resume_text").inputValue()).toBe("");
  });
  it.each(["Existing private resume text", "   "])("refuses nonempty alternatives without reading their contents out or clearing them: %j", async text => {
    await grouped(); await page.locator("#resume_text").fill(text);
    await expect(session.attachResume(file, true)).rejects.toThrow(/nonempty/);
    expect(await page.locator("#resume_text").inputValue()).toBe(text);
    expect(await page.locator("#resume").evaluate(el => (el as HTMLInputElement).files!.length)).toBe(0);
  });
  it("refuses an alternative omitted from the reviewed scope", async () => {
    await grouped(); delete file.target.alternative;
    await expect(session.attachResume(file, true)).rejects.toThrow(/unreviewed/);
  });
  it("refuses a forged alternative identity", async () => {
    await grouped(); file.target.alternative!.id = "q";
    await expect(session.attachResume(file, true)).rejects.toThrow(/alternative changed/);
  });
  it("stops if a file event populates the alternative, without erasing text or retrying", async () => {
    await grouped(); await page.evaluate(() => document.querySelector("#resume")!.addEventListener("change", () => { (document.querySelector("#resume_text") as HTMLTextAreaElement).value = "Inserted by page"; }));
    await expect(session.attachResume(file, true)).rejects.toThrow(/stopped/);
    expect(await page.locator("#resume_text").inputValue()).toBe("Inserted by page");
    await expect(session.attachResume(file, true)).rejects.toThrow(/scope/);
  });
  it.each(["missing", "duplicate", "label"])("stops when the grouped alternative becomes %s", async kind => {
    await grouped(); await page.evaluate(reason => {
      if (reason === "missing") document.querySelector("#resume_text")!.remove();
      if (reason === "duplicate") document.body.insertAdjacentHTML("beforeend", '<textarea id="resume_text"></textarea>');
      if (reason === "label") document.querySelector('label[for="resume_text"]')!.textContent = "Other information";
    }, kind);
    await expect(session.attachResume(file, true)).rejects.toThrow(/changed/);
  });
  it("attaches exact bytes only after network freeze and separate consent, then refuses replay", async () => {
    await expect(session.attachResume(file, true)).rejects.toThrow(/scope/);
    await session.freezeNetwork(); await expect(session.attachResume(file, false as true)).rejects.toThrow(/scope/);
    const result = await session.attachResume(file, true);
    expect(result).toMatchObject({ outputHash: file.outputHash, byteSize: file.buffer.length });
    expect(await page.locator('input[type="file"]').evaluate(el => (el as HTMLInputElement).files![0]!.name)).toBe("resume.docx");
    await expect(session.attachResume(file, true)).rejects.toThrow(/scope/);
  });
  it.each(["occupied", "multiple", "directory", "accept"])("refuses a %s file control", async kind => {
    if (kind === "occupied") await page.locator('input[type="file"]').setInputFiles({ name: "existing.pdf", mimeType: "application/pdf", buffer: Buffer.from("EXISTING") });
    await page.locator('input[type="file"]').evaluate((el, reason) => {
      const input = el as HTMLInputElement;
      if (reason === "multiple") input.multiple = true;
      if (reason === "directory") input.webkitdirectory = true;
      if (reason === "accept") input.accept = ".pdf";
    }, kind);
    await refreshEvidence(); // Test the low-level refusal even with freshly reviewed structure.
    await session.freezeNetwork(); await expect(session.attachResume(file, true)).rejects.toThrow(/stopped/);
    expect(await page.locator('input[type="file"]').evaluate(el => (el as HTMLInputElement).files?.length)).toBe(kind === "occupied" ? 1 : 0);
  });
  it.each(["hash", "size", "name", "label", "mime"])("refuses mismatched attachment %s", async kind => {
    if (kind === "hash") file.outputHash = "f".repeat(64);
    if (kind === "size") file.buffer = Buffer.alloc(5_000_001);
    if (kind === "name") file.fileName = "../secret.docx" as "resume.docx";
    if (kind === "label") file.target.label = "Passport";
    if (kind === "mime") file.mimeType = "application/pdf" as ResumeAttachment["mimeType"];
    await session.freezeNetwork(); await expect(session.attachResume(file, true)).rejects.toThrow(/Unsupported/);
  });
  it.each(['clip-path:inset(50%)', 'opacity:0'])("refuses attaching to a visually hidden file control even with fresh evidence: %s", async style => {
    await page.locator('#resume').evaluate((el, css) => el.setAttribute('style', css), style);
    await refreshEvidence(); await session.freezeNetwork();
    await expect(session.attachResume(file, true)).rejects.toThrow(/target changed/);
    expect(await page.locator('#resume').evaluate(el => (el as HTMLInputElement).files!.length)).toBe(0);
  });
  it("binds file filter metadata to page evidence before attachment", async () => {
    await page.locator('#resume').evaluate(el => el.setAttribute('accept', '.pdf'));
    await session.freezeNetwork();
    await expect(session.attachResume(file, true)).rejects.toThrow(/page changed/);
    expect(await page.locator('#resume').evaluate(el => (el as HTMLInputElement).files!.length)).toBe(0);
  });
  it("binds upload group ownership to page evidence", async () => {
    await page.evaluate(() => {
      const input = document.querySelector('#resume')!; const group = document.createElement('div');
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Resume'); input.before(group); group.append(input);
    });
    await refreshEvidence(); await session.freezeNetwork();
    await page.locator('[role=group]').evaluate(el => el.setAttribute('aria-label', 'Cover letter'));
    await expect(session.attachResume(file, true)).rejects.toThrow(/page changed/);
  });
  it("detects a change handler replacing the selected file and spends consent", async () => {
    await page.evaluate(() => document.querySelector('input[type="file"]')!.addEventListener("change", event => { (event.target as HTMLInputElement).value = ""; }));
    await session.freezeNetwork(); await expect(session.attachResume(file, true)).rejects.toThrow(/stopped/);
    await expect(session.attachResume(file, true)).rejects.toThrow(/scope/);
  });
  it("requires network freeze, fills exact text, emits native input and returns only a receipt", async () => {
    await expect(session.fill(row)).rejects.toThrow(/offline/);
    await page.evaluate(() => document.querySelector("textarea")!.addEventListener("input", () => document.documentElement.dataset.inputSeen = "yes"));
    await session.freezeNetwork(); const result = await session.fill(row);
    expect(await page.locator("textarea").inputValue()).toBe(row.text);
    expect(await page.locator("html").getAttribute("data-input-seen")).toBe("yes");
    expect(result).toMatchObject({ questionId: "q1", verified: true }); expect(JSON.stringify(result)).not.toContain(row.text);
    await expect(session.fill(row)).rejects.toThrow(/single-use/);
  });
  it.each(["nonempty", "readonly", "maxlength"])("does not overwrite a %s field", async kind => {
    await page.locator("textarea").evaluate((el, reason) => {
      if (!(el instanceof HTMLTextAreaElement)) throw new Error("Fixture target changed");
      if (reason === "nonempty") el.value = "User content";
      if (reason === "readonly") el.readOnly = true;
      if (reason === "maxlength") el.maxLength = 2;
    }, kind);
    await session.freezeNetwork(); await expect(session.fill(row)).rejects.toThrow(/stopped/);
    expect(await page.locator("textarea").inputValue()).toBe(kind === "nonempty" ? "User content" : "");
  });
  it.each(["label", "captcha", "duplicate", "disabled", "hidden"])("stops on %s drift before writing", async kind => {
    await page.evaluate(reason => {
      if (reason === "label") document.querySelector("label")!.textContent = "Describe your salary";
      if (reason === "captcha") document.body.insertAdjacentHTML("beforeend", '<div id="captcha"></div>');
      if (reason === "duplicate") document.body.insertAdjacentHTML("beforeend", '<textarea id="q"></textarea>');
      if (reason === "disabled") document.querySelector("textarea")!.disabled = true;
      if (reason === "hidden") document.querySelector("textarea")!.hidden = true;
    }, kind);
    await session.freezeNetwork(); await expect(session.fill(row)).rejects.toThrow(/changed/);
    expect(await page.locator("textarea").first().inputValue()).toBe("");
  });
  it.each(["Describe your visa", "Describe salary expectations", "Explain your medical condition", "Describe your API key"])("rejects private target %s", async label => {
    row.target.label = label; await session.freezeNetwork(); await expect(session.fill(row)).rejects.toThrow(/ordinary/);
  });
  it.each(["file", "email", "submit", "password"])("refuses %s writes", async type => {
    row.target.tag = "input"; row.target.type = type; await session.freezeNetwork(); await expect(session.fill(row)).rejects.toThrow(/ordinary/);
  });
  it("detects an input handler changing the answer and spends the reservation even on failure", async () => {
    await page.evaluate(() => document.querySelector("textarea")!.addEventListener("input", event => { (event.target as HTMLTextAreaElement).value = "changed"; }));
    await session.freezeNetwork(); await expect(session.fill(row)).rejects.toThrow(/stopped/);
    await expect(session.fill(row)).rejects.toThrow(/single-use/);
  });
  it("refuses a closed session", async () => {
    await session.freezeNetwork(); await session.close(); await expect(session.fill(row)).rejects.toThrow(/ended/);
  });
});
