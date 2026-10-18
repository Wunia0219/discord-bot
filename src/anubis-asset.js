// This export is a tall reel symbol, not a freestanding character. Remove only
// its panel crop/backdrop; keep the character's local shading and flame effects.
export function prepareAnubisData(original) {
  const data = structuredClone(original);
  const panelSlots = new Set(data.slots.filter(slot => slot.name === 'm' ||
    /^character_symbol_anubis_(bg2?|shadow|overall_shadow|frame_.*)$/.test(slot.name)).map(slot => slot.name));
  for (const slot of data.slots) if (panelSlots.has(slot.name)) delete slot.attachment;
  for (const skin of data.skins) for (const name of panelSlots) delete skin.attachments[name];
  for (const animation of Object.values(data.animations)) {
    for (const name of panelSlots) delete animation.slots?.[name];
    for (const skin of Object.values(animation.deform ?? {})) for (const name of panelSlots) delete skin[name];
  }
  return data;
}
