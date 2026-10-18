/** Fixed, proportional regions in reference design units (1920×1080). */
export const TEMPLATE_01 = Object.freeze({
  id: 'butcher-01',
  width: 1920,
  height: 1080,
  maxVisibleProducts: 8,
  regions: Object.freeze({
    logo: Object.freeze({ x: 90, y: 82, width: 675, height: 205 }),
    heading: Object.freeze({ x: 48, y: 285, width: 910, height: 120 }),
    products: Object.freeze({ x: 52, y: 405, width: 892, height: 550 }),
    video: Object.freeze({ x: 973, y: 357, width: 886, height: 592 }),
    footer: Object.freeze({ x: 380, y: 962, width: 1280, height: 88 }),
  }),
});

export function regionCss(region, template = TEMPLATE_01) {
  if (!region || ![region.x, region.y, region.width, region.height].every(Number.isFinite)) {
    throw new TypeError('Invalid template region');
  }
  if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
      region.x + region.width > template.width || region.y + region.height > template.height) {
    throw new RangeError('Template region outside design bounds');
  }
  return Object.freeze({
    left: `${region.x / template.width * 100}%`,
    top: `${region.y / template.height * 100}%`,
    width: `${region.width / template.width * 100}%`,
    height: `${region.height / template.height * 100}%`,
  });
}

export function applyTemplateRegions(root, template = TEMPLATE_01) {
  for (const [key, region] of Object.entries(template.regions)) {
    const node = root.querySelector(`[data-region="${key}"]`);
    if (node) Object.assign(node.style, regionCss(region, template));
  }
}
