export const MAX_IMAGE_LINKS = 100;

// Org inline images are links without a description. Keep web links as links.
export function localImageTarget(reference) {
  if (typeof reference !== 'string' || reference.length > 8192) return null;
  const match = reference.match(/^\[\[([^\]\r\n]+)\]\]$/);
  if (!match) return null;
  const target = match[1];
  const local = target.replace(/^file:/i, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(local) || !/\.(?:png|jpe?g|gif|webp|svg)$/i.test(local)) return null;
  return target;
}
