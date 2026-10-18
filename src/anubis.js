import { CanvasSource, Sprite, Texture } from 'pixi.js';
import { Renderer, BaseTexture } from '@pixi/core';
import { TextureAtlas } from '@pixi-spine/base';
import { AtlasAttachmentLoader, SkeletonJson, Spine } from '@pixi-spine/runtime-3.8';
import skeletonUrl from '../images/spine/anubis/character_anubis.json?url';
import atlasText from '../images/spine/anubis/character_anubis.atlas?raw';
import imageUrl from '../images/spine/anubis/character_anubis.png';
import { playAnubisResult, resetAnubisIdle } from './guardian-animation.js';
import { prepareAnubisData } from './anubis-asset.js';

// Spine 3.8's legacy adapter is a Pixi 7 renderer. Render one character
// into a transparent canvas and share it with the Pixi 8 stage, retaining weighted
// meshes, deforms, rotated atlas regions and additive FX without format conversion.
export class Anubis extends Sprite {
  static async create() {
    const image = new Image(); image.src = imageUrl;
    const [response] = await Promise.all([fetch(skeletonUrl), image.decode()]);
    if (!response.ok) throw new Error('無法載入阿努比斯骨架');
    const skeletonJson = prepareAnubisData(await response.json());
    const base = BaseTexture.from(image);
    const atlas = await new Promise(resolve => new TextureAtlas(atlasText, (_name, done) => done(base), resolve));
    const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(skeletonJson);
    const spine = new Spine(data); spine.autoUpdate = false;
    spine.stateData.defaultMix = .12;
    // Room for the moving hand/flame, with a stable origin across animations.
    const canvas = document.createElement('canvas');
    const renderer = new Renderer({ view: canvas, width: 800, height: 1280, resolution: 1, backgroundAlpha: 0, antialias: true, preserveDrawingBuffer: true });
    spine.position.set(260, 520);
    const source = new CanvasSource({ resource: canvas, resolution: 1, alphaMode: 'premultiplied-alpha' });
    const guardian = new Anubis(new Texture({ source }));
    Object.assign(guardian, { spine, renderer, atlas, source, elapsed: 0 });
    guardian.idle(); guardian.advance(0, true);
    return guardian;
  }
  idle() { resetAnubisIdle(this.spine.state); }
  react(wins) { playAnubisResult(this.spine.state, wins); }
  layout(compact) {
    const scale = compact ? .24 : .42;
    this.scale.set(scale);
    this.position.set((compact ? 193 : 110) - 260 * scale, (compact ? 465 : 365) - 520 * scale);
  }
  advance(delta, force = false) {
    this.elapsed += delta;
    if (!force && this.elapsed < 1 / 30) return;
    this.spine.update(this.elapsed); this.elapsed = 0;
    this.renderer.render(this.spine);
    this.source.update();
  }
  destroy(options) {
    this.spine.destroy({ children: true });
    this.renderer.destroy(true); this.atlas.dispose();
    super.destroy({ ...options, texture: true, textureSource: true });
  }
}
