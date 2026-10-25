// What a link points at: a web or mail address, or a page of this document
// (a number). Addresses without a scheme are taken as web addresses; any
// other scheme (javascript:, file:, data:) is refused.
export function linkTarget(raw: string, pages: number): { uri: string } | { page: number } | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{1,6}$/.test(v)) {
    const n = Number(v);
    return n >= 1 && n <= pages ? { page: n - 1 } : null;
  }
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return /\s/.test(v) || v.length > 2000 ? null : { uri: v };
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^:/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(v)) return null;
  if (/^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(v)) return { uri: `mailto:${v}` };
  return /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(v) && v.length <= 2000 ? { uri: `https://${v}` } : null;
}
