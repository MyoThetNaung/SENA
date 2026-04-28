import puppeteer from 'puppeteer';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';

let browserPromise = null;

/**
 * DuckDuckGo result link selectors — ordered by specificity.
 * When DDG changes their HTML, adding a new fallback only requires
 * appending to this array instead of editing page.evaluate() code.
 */
const DDG_RESULT_SELECTORS = [
  'a.result__a',
  'a.result__url',
  '.result__title a',
  '.result a.result__a',
  'a[href*="duckduckgo.com/l/?uddg="]',
  'a[href*="/l/?uddg="]',
  'a[href*="uddg="]',
];

/**
 * Wait-for selector list — a single CSS selector string used by
 * `page.waitForSelector()`.  We join with `,` so any match satisfies.
 */
const DDG_WAIT_SELECTOR = DDG_RESULT_SELECTORS.join(', ');

/** Reduces empty SERPs from services that throttle default headless Chrome. */
const CHROME_WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browserPromise;
}

async function applyRealBrowserProfile(page) {
  await page.setUserAgent(CHROME_WIN_UA);
  await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });
  await page.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9',
  });
  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch {
      /* ignore */
    }
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

const LOGIN_HINT = /\/(login|signin|sign-in|auth|oauth)(\/|$|\?)/i;

function looksLikeLoginUrl(url) {
  try {
    const u = new URL(url);
    return LOGIN_HINT.test(u.pathname + u.search);
  } catch {
    return true;
  }
}

function resolveDdgRedirectHref(href) {
  if (!href || typeof href !== 'string') return null;
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (u.hostname.includes('duckduckgo.com') && u.pathname.startsWith('/l/')) {
      const uddg = u.searchParams.get('uddg');
      if (uddg) {
        try {
          return decodeURIComponent(uddg);
        } catch {
          return uddg;
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (href.startsWith('http') && !href.includes('duckduckgo.com')) return href;
  return null;
}

/**
 * Parse DuckDuckGo HTML SERP without a browser (headless is often blocked on the search page).
 */
function extractDdgLinksFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const seen = new Set();
  const out = [];
  const rel = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = rel.exec(html)) !== null) {
    const raw = m[1].replace(/&amp;/g, '&');
    const resolved = resolveDdgRedirectHref(raw);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
      if (out.length >= 8) break;
    }
  }
  return out.slice(0, 5);
}

async function fetchDdgResultUrlsViaHttp(query, timeoutMs) {
  const q = encodeURIComponent(query.slice(0, 300));
  const searchUrl = `https://html.duckduckgo.com/html/?q=${q}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(searchUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': CHROME_WIN_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) {
      logger.warn(`DuckDuckGo HTTP fetch: status ${res.status}`);
      return [];
    }
    const html = await res.text();
    const urls = extractDdgLinksFromHtml(html);
    if (urls.length) {
      logger.info(`DuckDuckGo: ${urls.length} result URL(s) via HTTP (no headless on SERP).`);
    }
    return urls;
  } catch (e) {
    logger.warn(`DuckDuckGo HTTP fetch: ${e.message}`);
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Strip HTML to plain text for summarization (no extra deps). */
function htmlToPlainText(html) {
  let s = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

async function fetchPagePlainTextViaHttp(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': CHROME_WIN_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/html|xml|text\/plain/i.test(ct) && !/octet-stream/i.test(ct)) {
      return null;
    }
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > 600000 ? buf.slice(0, 600000) : buf;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    const plain = htmlToPlainText(html);
    return plain.length > 40 ? plain : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function extractVisibleText(page) {
  return page.evaluate(() => {
    const b = document.body;
    return b ? b.innerText : '';
  });
}

/**
 * DuckDuckGo HTML search → open top N result pages → visible text (max 2 pages, global timeout).
 */
export async function searchAndSummarize(query) {
  const { maxBrowsePages: maxPages, browserTimeoutMs: budgetMs } = getConfig();
  const started = Date.now();
  const remaining = () => Math.max(2000, budgetMs - (Date.now() - started));

  let hrefs = await fetchDdgResultUrlsViaHttp(query, Math.min(14000, remaining()));

  let browser;
  let searchPage = null;

  if (hrefs.length < 1) {
    try {
      browser = await getBrowser();
    } catch (e) {
      logger.error(`Puppeteer launch failed: ${e.message}`);
      return { ok: false, error: 'Browser failed to start. Check Puppeteer/Chromium installation.' };
    }
    searchPage = await browser.newPage();
    try {
      await applyRealBrowserProfile(searchPage);
      searchPage.setDefaultTimeout(Math.min(10000, remaining()));
      const q = encodeURIComponent(query.slice(0, 300));
      const searchUrl = `https://html.duckduckgo.com/html/?q=${q}`;

      await withTimeout(
        searchPage.goto(searchUrl, { waitUntil: 'load' }),
        Math.min(15000, remaining()),
        'DuckDuckGo search'
      );

      await searchPage
        .waitForSelector(DDG_WAIT_SELECTOR, {
          timeout: Math.min(12000, remaining()),
        })
        .catch(() => {
          logger.warn('DuckDuckGo (headless): no result links within timeout.');
        });

      hrefs = await searchPage.evaluate((selectors) => {
        function resolve(href) {
          if (!href) return null;
          try {
            const u = new URL(href, 'https://duckduckgo.com');
            if (u.hostname.includes('duckduckgo.com') && u.pathname.startsWith('/l/')) {
              const uddg = u.searchParams.get('uddg');
              if (uddg) {
                try {
                  return decodeURIComponent(uddg);
                } catch {
                  return uddg;
                }
              }
            }
          } catch {
            /* ignore */
          }
          if (href.startsWith('http') && !href.includes('duckduckgo.com')) return href;
          return null;
        }
        const seen = new Set();
        const out = [];
        const add = (href) => {
          const r = resolve(href);
          if (r && !seen.has(r)) {
            seen.add(r);
            out.push(r);
          }
        };
        for (const sel of selectors) {
          for (const a of Array.from(document.querySelectorAll(sel))) {
            add(a.getAttribute('href'));
            if (out.length >= 8) break;
          }
          if (out.length >= 8) break;
        }
        return out.slice(0, 5);
      }, DDG_RESULT_SELECTORS);

      if (!hrefs.length) {
        const hint = await searchPage.evaluate(() => {
          const t = (document.body && document.body.innerText) || '';
          return t.slice(0, 400).replace(/\s+/g, ' ').trim();
        });
        logger.warn(`DuckDuckGo (headless): zero result URLs. Page text sample: ${hint || '(empty)'}`);
      }
    } catch (e) {
      logger.error(`searchAndSummarize (SERP): ${e.message}`);
      await searchPage?.close().catch(() => {});
      return { ok: false, error: e.message || 'DuckDuckGo search failed.' };
    }
  }

  try {
    const texts = [];
    for (const href of hrefs) {
      if (texts.length >= maxPages) break;
      if (looksLikeLoginUrl(href)) {
        logger.info(`Skipping probable login URL: ${href}`);
        continue;
      }

      const pageBudget = Math.min(12000, remaining());
      let cleaned = await fetchPagePlainTextViaHttp(href, pageBudget);
      if (cleaned && cleaned.length > 60) {
        texts.push(cleaned.slice(0, 15000));
        continue;
      }

      try {
        if (!browser) browser = await getBrowser();
      } catch (e) {
        logger.error(`Puppeteer launch failed: ${e.message}`);
        return { ok: false, error: 'Browser failed to start. Check Puppeteer/Chromium installation.' };
      }

      const p2 = await browser.newPage();
      try {
        await applyRealBrowserProfile(p2);
        p2.setDefaultTimeout(Math.min(10000, remaining()));
        await withTimeout(
          p2.goto(href, { waitUntil: 'load' }),
          Math.min(15000, remaining()),
          'Result page'
        );
        await p2
          .waitForFunction(
            () => {
              const t = document.body && document.body.innerText;
              return typeof t === 'string' && t.replace(/\s+/g, ' ').trim().length > 60;
            },
            { timeout: Math.min(8000, remaining()) }
          )
          .catch(() => {});
        const txt = await extractVisibleText(p2);
        cleaned = String(txt || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 15000);
        if (cleaned.length > 60) texts.push(cleaned);
      } catch (e) {
        logger.warn(`Page fetch skipped: ${e.message}`);
      } finally {
        await p2.close().catch(() => {});
      }
    }

    if (!texts.length) {
      return {
        ok: false,
        error:
          'No readable pages retrieved (DuckDuckGo had no links, or sites blocked access / timed out). Retry later or try a more specific query.',
      };
    }
    return { ok: true, pageTexts: texts };
  } catch (e) {
    logger.error(`searchAndSummarize error: ${e.message}`);
    return { ok: false, error: e.message || 'Unknown browser error' };
  } finally {
    await searchPage?.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close().catch(() => {});
  }
}
