import { createHash } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import { requireAutomaticDecision } from "./policy-gate.js";

export interface ObservedControl {
  ref: string; id: string; name: string; label: string; tag: string; type: string;
  required: boolean; disabled: boolean; visible: boolean; optionLabels: string[];
  upload?: {
    accept: string[]; multiple: boolean; directory: boolean;
    trigger?: { forId: string; label: string; visible: boolean; associated: boolean } | null;
    group: { label: string; labelStatus: "explicit" | "missing" | "ambiguous"; fieldIds: string[]; triggerTargets: string[] } | null;
  };
}
export interface ResumePicker { forId: string; label: string; groupLabel: string }
/** Narrow offline attachment adapter, not general hidden-control write authority. */
export function labelledResumePicker(control: ObservedControl): ResumePicker | undefined {
  const upload = control.upload; const group = upload?.group; const trigger = upload?.trigger;
  if (control.tag !== "input" || control.type !== "file" || control.id !== "resume" || !["", "resume", "job_application[resume]"].includes(control.name)
    || control.visible || control.disabled || control.label !== "Attach" || control.optionLabels.length
    || !upload || upload.multiple || upload.directory || !group || group.labelStatus !== "explicit"
    || !/^(resume|cv|resume\s*\/\s*cv)\s*\*?$/i.test(group.label.trim())
    || group.fieldIds.length !== 2 || !["resume", "resume_text"].every(id => group.fieldIds.filter(v => v === id).length === 1)
    || group.triggerTargets.filter(id => id === "resume").length !== 1 || group.triggerTargets.some(id => !["resume", "resume_text"].includes(id))
    || new Set(group.triggerTargets).size !== group.triggerTargets.length
    || !trigger || trigger.forId !== "resume" || trigger.label !== "Attach" || !trigger.visible || !trigger.associated) return undefined;
  return { forId: trigger.forId, label: trigger.label, groupLabel: group.label };
}
export interface GreenhouseDomSnapshot {
  url: string; observedAt: string; controls: ObservedControl[]; signals: string[];
  structureHash: string; blockedRequests: number; canFill: false; canSubmit: false;
}
export function greenhouseTarget(board: string, externalId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(board) || !/^\d{1,20}$/.test(externalId)) throw new Error("Unsupported Greenhouse identity.");
  return `https://job-boards.greenhouse.io/${board.toLowerCase()}/jobs/${externalId}`;
}
const LOCALE_PATH = /^\/locales\/en\/(?:job_post|common)\.[a-zA-Z0-9_-]{43}\.json$/;
const LOCALE_BYTE_LIMIT = 128_000;
function isPresentationLocale(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash
      && url.hostname === "job-boards.cdn.greenhouse.io" && LOCALE_PATH.test(url.pathname);
  } catch { return false; }
}
/** Only the exact posting document and versioned public presentation assets, including
 * two English translation namespaces required by the hosted page's initialization. No API writes,
 * third-party traffic, search parameters, frames, redirects or arbitrary caller URLs. */
export function allowObservationRequest(target: string, raw: string, method: string, resourceType: string, redirected = false) {
  if (method !== "GET" || redirected) return false;
  let url: URL; try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
  if (resourceType === "document") return raw === target;
  if (resourceType === "fetch" && isPresentationLocale(raw)) return true;
  return ["script", "stylesheet"].includes(resourceType) && url.hostname === "job-boards.cdn.greenhouse.io"
    && /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(url.pathname);
}

// Fixed read-only code: neither values, checked/selected state, HTML, scripts nor cookies leave the page.
const READ_DOM = `(() => {
  const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim().slice(0, 1000);
  const text = (element) => {
    if (!element || element.matches('input,textarea,select,[contenteditable],script,style')) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll('input,textarea,select,[contenteditable],script,style').forEach(n => n.remove());
    return clean(clone.textContent);
  };
  // Layout boxes alone also describe screen-reader-only file inputs. Conservative:
  // clipped/transparent controls (including ancestor styles) stay manual, not writable.
  const visible = (el) => {
    if (![...el.getClientRects()].some(r => r.width > 0 && r.height > 0)) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || ['hidden','collapse'].includes(style.visibility)
        || Number(style.opacity) === 0 || style.contentVisibility === 'hidden'
        || style.clip !== 'auto' || style.clipPath !== 'none') return false;
      if (['hidden','clip'].includes(style.overflowX) && node.clientWidth === 0
        || ['hidden','clip'].includes(style.overflowY) && node.clientHeight === 0) return false;
    }
    return true;
  };
  const label = (el) => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
    if (ids.length) return clean(ids.map(id => text(document.getElementById(id))).join(' '));
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    if (el.labels && el.labels.length) return clean([...el.labels].map(text).join(' '));
    return text(el.closest('label')) || (el.tagName === 'BUTTON' ? text(el) : '');
  };
  const all = [...document.querySelectorAll('input,select,textarea,button,[role="combobox"],[contenteditable="true"]')];
  const upload = (el) => {
    if (el.tagName !== 'INPUT' || el.type !== 'file') return {};
    const group = el.closest('[role="group"],fieldset');
    let evidence = null;
    if (group) {
      const ids = (group.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
      let label = ''; let labelStatus = 'missing';
      if (ids.length) {
        const labels = ids.slice(0,10).map(id => [...document.querySelectorAll('[id]')].filter(n => n.id === id));
        if (ids.length > 10 || new Set(ids).size !== ids.length || labels.some(nodes => nodes.length > 1)) labelStatus = 'ambiguous';
        else if (labels.every(nodes => nodes.length === 1 && text(nodes[0]))) { label = clean(labels.map(nodes => text(nodes[0])).join(' ')); labelStatus = 'explicit'; }
      } else if (group.getAttribute('aria-label')) { label = clean(group.getAttribute('aria-label')); labelStatus = label ? 'explicit' : 'missing'; }
      else if (group.tagName === 'FIELDSET') {
        const legends = [...group.children].filter(n => n.tagName === 'LEGEND');
        if (legends.length > 1) labelStatus = 'ambiguous';
        else if (legends.length === 1 && text(legends[0])) { label = text(legends[0]); labelStatus = 'explicit'; }
      }
      const belongs = n => n.closest('[role="group"],fieldset') === group;
      evidence = { label, labelStatus,
        fieldIds: [...group.querySelectorAll('input,textarea,select')].filter(belongs).slice(0,100).map(n => clean(n.id)).filter(Boolean),
        triggerTargets: [...group.querySelectorAll('label[for]')].filter(belongs).slice(0,100).map(n => clean(n.getAttribute('for'))).filter(Boolean) };
    }
    const labels = [...(el.labels || [])];
    const trigger = group && labels.length === 1 && labels[0].closest('[role="group"],fieldset') === group ? {
      forId: clean(labels[0].htmlFor), label: text(labels[0]), visible: visible(labels[0]),
      associated: labels[0].control === el && !!el.id && [...document.querySelectorAll('[id]')].filter(n => n.id === el.id).length === 1
    } : null;
    return { upload: { accept: el.accept.split(',').map(clean).filter(Boolean).slice(0,100), multiple: el.multiple, directory: el.webkitdirectory, group: evidence, trigger } };
  };
  const signals = [];
  const bodyClone = document.body.cloneNode(true);
  bodyClone.querySelectorAll('input,textarea,select,[contenteditable],script,style').forEach(n => n.remove());
  const body = (bodyClone.textContent || '').slice(0,180000);
  if (document.querySelector('input[type="password"],input[autocomplete="one-time-code"]') || /(?:sign in to apply|log in to apply|verification code|two.factor authentication)/i.test(body)) signals.push('login_or_mfa');
  if (document.querySelector('[class*="captcha"],[id*="captcha"],iframe[src*="captcha"],iframe[title*="challenge"],script[src*="recaptcha"],script[src*="hcaptcha"]') || /verify (?:you are|that you are) human|access denied|unusual traffic/i.test(body)) signals.push('captcha_or_access_check');
  if (/job (?:is no longer|has been closed)|position (?:has been filled|is no longer available)/i.test(body)) signals.push('posting_unavailable');
  if (document.querySelector('iframe,frame')) signals.push('unobserved_frames');
  if (all.length > 300) signals.push('control_limit');
  const controls = all.slice(0,300).map((el,index) => ({
    ref:'dom:'+index, id:clean(el.id), name:clean(el.getAttribute('name')), label:label(el),
    tag:el.tagName.toLowerCase(), type:clean(el.getAttribute('role') || el.getAttribute('type') || (el.tagName === 'INPUT' ? 'text' : el.tagName === 'SELECT' && el.multiple ? 'select-multiple' : el.tagName.toLowerCase())),
    required:!!el.required || el.getAttribute('aria-required') === 'true', disabled:!!el.disabled || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true', visible:visible(el),
    optionLabels:el.tagName === 'SELECT' ? [...el.options].slice(0,100).map(o => clean(o.label)) : [], ...upload(el)
  }));
  if (!controls.some(c => c.visible && ['input','select','textarea'].includes(c.tag) && !['hidden','submit','button'].includes(c.type))) signals.push('no_visible_form');
  if (controls.some(c => c.type === 'combobox' || c.tag === 'div')) signals.push('custom_controls_need_review');
  return {controls,signals};
})()`;
export async function readGreenhouseDom(page: Page) {
  return page.evaluate<{ controls: ObservedControl[]; signals: string[] }>(READ_DOM);
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
/** Internal browser-service primitive. Handles never cross the local HTTP boundary. */
export async function openRestrictedGreenhousePage(board: string, externalId: string, headed = false, lifetimeMs = 30000) {
  const target = greenhouseTarget(board, externalId);
  let browser: Browser | undefined; let deadline: ReturnType<typeof setTimeout> | undefined;
  let closed = false; let locked = false;
  const close = async () => { closed = true; if (deadline) clearTimeout(deadline); await browser?.close().catch(() => undefined); };
  let stage: "launch" | "navigation" | "snapshot" = "launch";
  try {
    const gate = (tool: "browser_session_open" | "browser_snapshot") => requireAutomaticDecision({
      tool, actionId: `observation:${tool}`, decisionId: `observation-policy:${tool}`, evaluatedAt: new Date().toISOString(),
      targetOrigin: new URL(target).origin, allowedOrigins: [new URL(target).origin], safetySignals: [], automationMode: "standard",
      ...(tool === "browser_snapshot" ? { currentOrigin: new URL(target).origin } : {}),
    });
    gate("browser_session_open");
    browser = await chromium.launch({ headless: !headed, timeout: 15000 });
    deadline = setTimeout(() => { void close(); }, Math.min(Math.max(lifetimeMs, 1000), 600000));
    deadline.unref();
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, permissions: [] });
    let requests = 0; let blockedRequests = 0; let bytes = 0; let exhausted = false;
    let pendingLocales = 0; let localeFailed = false;
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.route("**/*", async route => {
      const request = route.request();
      if (++requests > 80 || locked || !allowObservationRequest(target, request.url(), request.method(), request.resourceType(), !!request.redirectedFrom())
        || (request.isNavigationRequest() && request.frame().parentFrame() !== null)) {
        blockedRequests++; if (requests > 80) exhausted = true;
        await route.abort(); return;
      }
      const locale = isPresentationLocale(request.url());
      if (locale) pendingLocales++;
      try {
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10000,
          headers: { Accept: request.resourceType() === "document" ? "text/html" : "*/*" } });
        if (locked || closed || response.status() >= 300 && response.status() < 400
          || Number(response.headers()["content-length"]) > (locale ? LOCALE_BYTE_LIMIT : 8_000_000)) {
          if (locale) localeFailed = true;
          blockedRequests++; await response.dispose(); await route.abort(); return;
        }
        const body = await response.body(); bytes += body.length;
        // Do not deliver in-flight presentation responses after the one-way network lock.
        if (locked || closed) { if (locale) localeFailed = true; blockedRequests++; await route.abort(); }
        else if (body.length > (locale ? LOCALE_BYTE_LIMIT : 8_000_000) || bytes > 30_000_000) {
          if (locale) localeFailed = true;
          exhausted = true; blockedRequests++; await route.abort();
        }
        else {
          let validLocale = true;
          if (locale) {
            try {
              const parsed: unknown = JSON.parse(body.toString("utf8"));
              validLocale = response.status() === 200 && response.headers()["content-type"]?.split(";")[0]?.trim().toLowerCase() === "application/json"
                && parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
            } catch { validLocale = false; }
          }
          if (!validLocale) { localeFailed = true; blockedRequests++; await route.abort(); }
          else {
            const headers = { ...response.headers() }; delete headers["set-cookie"];
            await route.fulfill({ status: response.status(), headers, body });
          }
        }
        await response.dispose();
      } catch { if (locale) localeFailed = true; blockedRequests++; await route.abort().catch(() => undefined); }
      finally { if (locale) pendingLocales--; }
    });
    const page = await context.newPage();
    page.on("dialog", dialog => { void dialog.dismiss(); });
    context.on("page", other => { if (other !== page) void other.close(); });
    stage = "navigation";
    const response = await page.goto(target, { waitUntil: "load", timeout: 20000 });
    if (!response?.ok() || page.url() !== target) throw new Error("The hosted posting could not be safely opened. Inspect it manually.");
    stage = "snapshot";
    async function snapshot(): Promise<GreenhouseDomSnapshot> {
      if (closed || page.url() !== target) throw new Error("The supervised page is closed or moved.");
      gate("browser_snapshot");
      const raw = await readGreenhouseDom(page);
      return { url: target, observedAt: new Date().toISOString(), controls: raw.controls,
        signals: [...new Set([...raw.signals, ...(exhausted ? ["network_limit"] : []),
          ...(pendingLocales || localeFailed ? ["presentation_assets_incomplete"] : []), ...(blockedRequests ? ["restricted_network_partial_view"] : [])])],
        structureHash: digest(raw), blockedRequests, canFill: false, canSubmit: false };
    }
    const first = await snapshot();
    // A bounded second sample detects immediate hydration drift; it cannot prove future stability.
    const mustStop = first.signals.some(s => ["login_or_mfa", "captcha_or_access_check", "posting_unavailable"].includes(s));
    if (!mustStop) await new Promise(resolve => setTimeout(resolve, 500));
    const second = mustStop ? first : await snapshot();
    if (page.url() !== target) throw new Error("The hosted page moved outside the approved posting.");
    const initial = { ...second, signals: [...new Set([...second.signals, ...(first.structureHash !== second.structureHash ? ["dom_changed_during_observation"] : [])])] };
    return { page, initial, snapshot, close, get alive() { return !closed && browser!.isConnected() && !page.isClosed(); },
      async freezeNetwork() { locked = true; await context.setOffline(true); } };
  } catch (error) {
    await close();
    // Playwright errors can include URLs, headers and page content; expose only our safe summary.
    throw new Error(`Hosted-page observation could not finish safely (${stage}). Check local Chromium installation or inspect the posting manually.`);
  }
}
let busy = false;
/** Public read-only operation still always closes its ephemeral browser. */
export async function observeGreenhousePage(board: string, externalId: string): Promise<GreenhouseDomSnapshot> {
  if (busy) throw new Error("A hosted-page observation is already running. Try again after it finishes.");
  busy = true;
  try { const session = await openRestrictedGreenhousePage(board, externalId); try { return session.initial; } finally { await session.close(); } }
  finally { busy = false; }
}
