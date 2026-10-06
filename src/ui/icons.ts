import * as THREE from 'three';
import { buildPistol, buildRifle, buildRock } from '../weapons/models';

/**
 * Renders the in-game voxel weapon models into small images for the HUD hotbar,
 * so the hotbar icon is literally the same rifle the hero carries.
 */
export function renderWeaponIcons(
  renderer: THREE.WebGLRenderer,
): Record<'rifle' | 'pistol' | 'rocks', string> {
  const W = 192;
  const H = 96;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.1, 10);
  cam.position.set(0, 0, 5);

  const shot = (obj: THREE.Object3D, rotY: number, rotZ: number, zoom: number): string => {
    scene.add(obj);
    obj.rotation.set(0, rotY, rotZ);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.sub(c);
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClear);
    scene.remove(obj);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    // Flip vertically (GL origin is bottom-left).
    for (let y = 0; y < H; y++)
      img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };

  const icons = {
    rifle: shot(buildRifle('hero'), -Math.PI / 2, 0, 1.7),
    pistol: shot(buildPistol(), -Math.PI / 2, 0, 2.9),
    rocks: shot(buildRock(1.3), 0.6, 0.3, 3.4),
  };
  rt.dispose();
  return icons;
}
