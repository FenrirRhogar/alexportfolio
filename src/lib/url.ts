// Prefixes a root-relative path (e.g. "/design/" or "/media/foo.svg") with the
// site's base path, so links and asset URLs still resolve when the site is
// deployed to a GitHub *project* page (served from a subpath, not the domain root).
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
