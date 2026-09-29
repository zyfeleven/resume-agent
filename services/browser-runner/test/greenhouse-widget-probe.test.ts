import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { readGreenhouseDom, type GreenhouseDomSnapshot } from '../src/greenhouse-observer.js';
import { probeGreenhouseResumeWidget } from '../src/greenhouse-widget-probe.js';

describe('offline resume widget switch in actual Chromium', () => {
  let browser: Browser; let context: BrowserContext;
  const url = 'https://job-boards.greenhouse.io/fixture/jobs/17';
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });
  afterEach(async () => { await context?.close(); });
  async function fixture(kind = 'normal') {
    context = await browser.newContext({ serviceWorkers: 'block' }); let frozen = false;
    const seen: boolean[] = [];
    await context.route('**/*', route => {
      if (route.request().url() !== url || frozen) { seen.push(frozen); return route.abort(); }
      return route.fulfill({ contentType: 'text/html', body: `<label for="q">Describe a project</label><textarea id="q"></textarea><div role="group" aria-label="${kind === 'cover_letter' ? 'Cover Letter' : 'Resume'}"><label for="resume">Attach</label><input id="resume" type="file" hidden><div><button type="${kind === 'submit' ? 'submit' : 'button'}" ${kind === 'disabled' ? 'disabled' : ''}>Enter manually</button><label for="${kind === 'wrong_label' ? 'other' : 'resume_text'}" hidden>Enter manually</label></div>${kind === 'mounted' ? '<textarea id="resume_text">PRIVATE_EXISTING</textarea>' : ''}${kind === 'duplicate' ? '<button type="button">Enter manually</button>' : ''}</div>${kind === 'captcha' ? '<div id="captcha"></div>' : ''}` });
    });
    const page = await context.newPage(); await page.goto(url);
    await page.locator('button').first().evaluate((el, reason) => {
      el.addEventListener('click', () => {
        document.documentElement.dataset.clicks = String(Number(document.documentElement.dataset.clicks ?? 0) + 1);
        void fetch('/forbidden', { method: 'POST', body: 'SIMULATED' }).catch(() => undefined);
        if (reason === 'missing_result') return;
        const text = document.createElement(reason === 'wrong_type' ? 'input' : 'textarea'); text.id = 'resume_text';
        if (reason === 'nonempty') text.value = 'PRIVATE_INSERTED';
        (reason === 'wrong_owner' ? document.body : el.closest('[role="group"]')!).append(text);
        if (reason === 'post_captcha') document.body.insertAdjacentHTML('beforeend', '<div id="captcha"></div>');
      });
    }, kind);
    const snapshot = async (): Promise<GreenhouseDomSnapshot> => {
      const raw = await readGreenhouseDom(page);
      return { ...raw, url, observedAt: new Date().toISOString(), structureHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex'), blockedRequests: seen.length, canFill: false, canSubmit: false };
    };
    const initial = await snapshot();
    if (kind === 'incomplete_assets') initial.signals.push('presentation_assets_incomplete');
    const close = vi.fn(async () => undefined);
    const freezeNetwork = vi.fn(async () => { frozen = true; await context.setOffline(true); if (kind === 'drift') await page.locator('#q').evaluate(el => el.setAttribute('disabled', '')); });
    const open = vi.fn(async () => ({ page, initial, snapshot, close, freezeNetwork, alive: true }));
    return { open, close, page, seen, freezeNetwork };
  }
  it('freezes before one switch, returns only diagnostic structure and always closes', async () => {
    const f = await fixture(); const result = await probeGreenhouseResumeWidget('fixture', '17', true, f.open);
    expect(f.freezeNetwork).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce();
    expect(await f.page.locator('html').getAttribute('data-clicks')).toBe('1');
    expect(result.controls.find(c => c.id === 'resume_text')?.tag).toBe('textarea');
    expect(result.signals).toContain('offline_widget_probe_not_fill_evidence');
    expect(result.canFill).toBe(false); expect(result.canSubmit).toBe(false);
    await vi.waitFor(() => expect(f.seen).toEqual([true]));
  });
  it('requires literal confirmation before opening', async () => {
    const f = await fixture(); await expect(probeGreenhouseResumeWidget('fixture', '17', false as true, f.open)).rejects.toThrow(/consent/);
    expect(f.open).not.toHaveBeenCalled();
  });
  it.each(['cover_letter', 'mounted', 'duplicate', 'submit', 'disabled', 'wrong_label', 'captcha', 'incomplete_assets', 'drift'])('refuses %s without clicking and closes', async kind => {
    const f = await fixture(kind); await expect(probeGreenhouseResumeWidget('fixture', '17', true, f.open)).rejects.toThrow(/inspection stopped/);
    expect(await f.page.locator('html').getAttribute('data-clicks')).toBeNull(); expect(f.close).toHaveBeenCalledOnce();
  });
  it.each(['nonempty', 'wrong_type', 'wrong_owner', 'post_captcha', 'missing_result'])('stops after %s with one click, redacted failure and no retry', async kind => {
    const f = await fixture(kind); await expect(probeGreenhouseResumeWidget('fixture', '17', true, f.open)).rejects.toThrow(/inspection stopped/);
    expect(await f.page.locator('html').getAttribute('data-clicks')).toBe('1'); expect(f.close).toHaveBeenCalledOnce();
  });
});
