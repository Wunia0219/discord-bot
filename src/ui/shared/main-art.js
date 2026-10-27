import mainUrl from '../../../images/main.webp';
import atlas from '../../../images/main.json';

// Use exported pixel coordinates directly, including TexturePacker's 0.5 export.
export function mainArt(name, className, hidden = false) {
  const entry = atlas.frames[name];
  if (!entry || entry.rotated) throw new Error(`Unsupported main atlas frame: ${name}`);
  const { x, y, w, h } = entry.frame;
  return `<div class="atlas-art ${className}" ${hidden ? 'hidden' : ''} style="aspect-ratio:${w}/${h}"><img src="${mainUrl}" alt="" style="width:${atlas.meta.size.w / w * 100}%;left:${-x / w * 100}%;top:${-y / h * 100}%" /></div>`;
}

export async function prepareMainArt() {
  const image = new Image(); image.src = mainUrl;
  await image.decode();
}
