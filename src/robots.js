// Minimal robots.txt check (the "User-agent: *" group, longest match wins, Allow wins ties),
// matching Apify's respectRobotsTxtFile. An unreadable robots.txt allows everything.

const cache = new Map();

function toRegex(rule) {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function parse(text) {
  const rules = [];
  let agents = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (inRules) { agents = []; inRules = false; }
      agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      inRules = true;
      if (agents.includes('*') && value) rules.push({ allow: field === 'allow', length: value.length, re: toRegex(value) });
    }
  }
  return rules;
}

async function rulesFor(origin, userAgent) {
  if (!cache.has(origin)) {
    cache.set(origin, (async () => {
      try {
        const res = await fetch(origin + '/robots.txt', { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(10000) });
        return res.ok ? parse(await res.text()) : [];
      } catch (e) {
        return [];
      }
    })());
  }
  return cache.get(origin);
}

export async function robotsAllowed(url, userAgent) {
  const u = new URL(url);
  const rules = await rulesFor(u.origin, userAgent);
  const path = u.pathname + u.search;
  let best = null;
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    if (!best || r.length > best.length || (r.length === best.length && r.allow)) best = r;
  }
  return !best || best.allow;
}
