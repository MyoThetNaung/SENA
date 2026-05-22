/** Normalize path for comparisons (no trailing slash except root). */
export function normalizePath(path) {
  const p = String(path || '').trim() || '/';
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}

/**
 * True when this nav item should show as active.
 * Parent paths like `/app` must not stay active on `/app/telegram` when that child is in the nav.
 * @param {string} pathname
 * @param {string} itemHref
 * @param {Array<{ href: string }>} navItems
 */
export function isNavItemActive(pathname, itemHref, navItems) {
  const path = normalizePath(pathname);
  const href = normalizePath(itemHref);
  if (path === href) return true;
  const childPrefix = `${href}/`;
  if (!path.startsWith(childPrefix)) return false;
  const longerMatch = navItems.some((other) => {
    const oh = normalizePath(other.href);
    if (oh === href || oh.length <= href.length) return false;
    if (!oh.startsWith(childPrefix)) return false;
    return path === oh || path.startsWith(`${oh}/`);
  });
  return !longerMatch;
}

/**
 * @param {string} pathname
 * @param {Array<{ href: string, label: string }>} navItems
 */
export function activeNavItem(pathname, navItems) {
  return navItems.find((item) => isNavItemActive(pathname, item.href, navItems)) || null;
}
