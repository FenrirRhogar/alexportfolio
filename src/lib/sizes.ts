// Display sizes picked in the dashboard for a project's main image, its
// gallery, and each flipbook/trifold. '' ("Standard") keeps each element's
// own default width, so nothing changes until a size is chosen. Unknown
// values also fall back to the default rather than breaking the page.
const WIDTHS: Record<string, string> = {
  small: '32rem',
  medium: '44rem',
  large: '60rem',
  xlarge: '76rem',
  full: '100%',
};

export function sizeStyle(size: string | undefined, fallback: string): string {
  return `max-width: ${WIDTHS[size ?? ''] ?? fallback}`;
}

// written out in full so Tailwind sees every class it needs to generate
const COLUMNS: Record<string, string> = {
  '1': 'columns-1',
  '2': 'columns-1 sm:columns-2',
  '3': 'columns-1 sm:columns-2 lg:columns-3',
};

export function galleryColumns(columns: string | undefined, fallback = '2'): string {
  return COLUMNS[columns ?? ''] ?? COLUMNS[fallback];
}
