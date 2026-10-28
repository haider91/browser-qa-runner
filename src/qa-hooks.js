// Attaches the QA listeners to a page before navigation, so nothing emitted during page load is missed.
// Ported from the Apify "preNavigationHooks" of voila-auditing-automation (same fields, same caps).

export async function attachQa(page, { blockHosts = [] } = {}) {
  const qa = { console: [], pageErrors: [], failed: [], bad: [], nav: null, warnings: 0 };

  // Chromium's own URL blocking (CDP) instead of page.route: request interception slowed every
  // navigation down until it timed out in testing. Blocked requests fail with ERR_BLOCKED_BY_CLIENT.
  if (blockHosts.length) {
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', { urls: blockHosts.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]) });
    } catch (e) {
      qa.blockError = String((e && e.message) || e).slice(0, 200);
    }
  }
  const cap = (arr, value, max) => { if (arr.length < max) arr.push(value); };

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') {
      const loc = msg.location() || {};
      cap(qa.console, { text: msg.text().slice(0, 500), url: (loc.url || '').slice(0, 300), line: loc.lineNumber || 0 }, 50);
    } else if (type === 'warning') {
      qa.warnings++;
    }
  });

  page.on('pageerror', (err) => {
    cap(qa.pageErrors, {
      message: String((err && err.message) || err).slice(0, 500),
      stack: String((err && err.stack) || '').slice(0, 800),
    }, 30);
  });

  page.on('requestfailed', (req) => {
    cap(qa.failed, {
      url: req.url().slice(0, 500),
      resourceType: req.resourceType(),
      failure: (req.failure() || {}).errorText || 'failed',
    }, 100);
  });

  page.on('response', (res) => {
    const status = res.status();
    const req = res.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      qa.nav = { status, url: res.url().slice(0, 500) };
    }
    if (status >= 400) {
      cap(qa.bad, { url: res.url().slice(0, 500), status, resourceType: req.resourceType() }, 100);
    }
  });

  await page.addInitScript(() => {
    window.__qaPerf = { lcp: 0, cls: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__qaPerf.lcp = e.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__qaPerf.cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      console.error('[qa:unhandledrejection] ' + ((r && (r.stack || r.message)) || String(r)));
    });
  });

  return qa;
}
