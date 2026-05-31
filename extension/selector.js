// Generates an ordered list of candidate selectors for an element, most
// robust first. The runner tries them in order (self-healing): if the first
// no longer matches after a UI change, it falls back to the next.
//
// Exposed as a global (content scripts share scope) as `RLSelector`.

(function () {
  const TEST_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'];

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function looksGenerated(id) {
    // skip ids that look auto-generated (hashes, long digit runs, emotion/mui)
    return /^[0-9]/.test(id) || /[0-9a-f]{6,}/.test(id) || id.length > 40 || /\d{4,}/.test(id);
  }

  function visibleText(el) {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > 0 && t.length <= 50 ? t : '';
  }

  function uniqueCss(el) {
    if (el.id && !looksGenerated(el.id)) return `#${cssEscape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      if (node.id && !looksGenerated(node.id)) {
        parts.unshift(`#${cssEscape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function selectorsFor(el) {
    const out = [];

    for (const attr of TEST_ATTRS) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v) out.push(`[${attr}="${v}"]`);
    }

    if (el.id && !looksGenerated(el.id)) out.push(`#${cssEscape(el.id)}`);

    const name = el.getAttribute && el.getAttribute('name');
    if (name) out.push(`${el.tagName.toLowerCase()}[name="${name}"]`);

    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) out.push(`[aria-label="${aria}"]`);

    const ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) out.push(`[placeholder="${ph}"]`);

    const tag = el.tagName.toLowerCase();
    const txt = visibleText(el);
    if (txt && (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button')) {
      // Playwright text engine; the runner understands "text=" prefixes.
      out.push(`text=${txt}`);
    }

    out.push(uniqueCss(el));

    // de-dupe preserving order
    return [...new Set(out)].filter(Boolean);
  }

  function labelFor(el) {
    return (
      (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) ||
      visibleText(el) ||
      (el.getAttribute && el.getAttribute('name')) ||
      el.tagName.toLowerCase()
    );
  }

  window.RLSelector = { selectorsFor, labelFor };
})();
