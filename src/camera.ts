import * as THREE from 'three';

// --- Camera tuning ---------------------------------------------------------
export const CAMERA_CONFIG = {
  /** Pitch below horizontal giving classic 2:1 dimetric tiles. */
  pitchRad: Math.atan(1 / 2),
  /** The four allowed yaw snap angles, degrees. */
  yawSnapsDeg: [45, 135, 225, 315],
  /** Duration of a yaw-snap rotation, ms. */
  rotateDurationMs: 250,
  /** Frustum heights (world units) for the three zoom steps, far → near. */
  zoomSteps: [56, 34, 20],
  /** frameWorld: loosest frustum height as a fraction of the island edge,
   * chosen so the whole island fits in view at any citySize. */
  frameFrac: 0.85,
  /** frameWorld: the three zoom steps as ratios of the loosest height. */
  zoomRatios: [1, 0.6, 0.36],
  /** Zoom step index at startup (0 = widest). */
  initialZoomStep: 0,
  /** Distance of the camera from its target along the view ray. */
  orbitRadius: 220,
  /** Keyboard pan speed, world units per second at zoom step 0. */
  panSpeed: 28,
  /** Width of the screen-edge band that triggers mouse panning, px. */
  edgePanBandPx: 24,
  /** Mouse edge-pan speed, world units per second at zoom step 0. */
  edgePanSpeed: 24,
  /**
   * Snap the camera target to the internal pixel grid every frame so pixels
   * don't shimmer while panning. Set false to compare the unstable version.
   */
  pixelSnapEnabled: true,
} as const;

const DEG2RAD = Math.PI / 180;

/** Ease-in-out for the yaw snap (era hardware faked this; we allow one nicety). */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// Scratch objects — module scope so the per-frame update allocates nothing.
const scratchOffset = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchSnapped = new THREE.Vector3();
const scratchPanDir = new THREE.Vector3();

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  private readonly target = new THREE.Vector3();
  private bounds: MapBounds;
  /** Active frustum heights; replaced by frameWorld() for generated cities. */
  private zoomHeights: number[] = [...CAMERA_CONFIG.zoomSteps];

  private yawIndex = 0;
  private yawFromDeg: number;
  private yawToDeg: number;
  private yawAnimStartMs = -1;
  private currentYawDeg: number;

  private zoomStep: number = CAMERA_CONFIG.initialZoomStep;
  private aspect = 16 / 9;
  /** Internal render-target width in pixels, set by retro pipeline. */
  private internalWidth = 640;

  private readonly keysDown = new Set<string>();
  private edgePanX = 0; // -1..1 from mouse position near screen edges
  private edgePanY = 0;

  constructor(bounds: MapBounds, startTarget: THREE.Vector3) {
    this.bounds = bounds;
    this.target.copy(startTarget);
    const firstYaw = CAMERA_CONFIG.yawSnapsDeg[0] ?? 45;
    this.yawFromDeg = firstYaw;
    this.yawToDeg = firstYaw;
    this.currentYawDeg = firstYaw;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.applyFrustum();
  }

  /** Called by retro pipeline once the internal resolution is chosen. */
  setInternalResolution(width: number, height: number): void {
    this.internalWidth = width;
    this.aspect = width / height;
    this.applyFrustum();
  }

  /** Re-clamp panning to a new map's bounds. */
  setBounds(bounds: MapBounds): void {
    this.bounds = bounds;
  }

  /** Frame a (possibly autoscaled) island: loosest zoom fits the whole map,
   * camera centered on the given target, zoom reset to the widest step. */
  frameWorld(worldSize: number, target: THREE.Vector3): void {
    const loosest = worldSize * CAMERA_CONFIG.frameFrac;
    this.zoomHeights = CAMERA_CONFIG.zoomRatios.map((r) => loosest * r);
    this.zoomStep = 0;
    this.target.copy(target);
    this.applyFrustum();
  }

  rotate(direction: 1 | -1): void {
    if (this.yawAnimStartMs >= 0) return; // ignore input mid-snap
    const snaps = CAMERA_CONFIG.yawSnapsDeg;
    this.yawFromDeg = this.yawToDeg;
    this.yawIndex = (this.yawIndex + direction + snaps.length) % snaps.length;
    // Rotate the short way: step exactly ±90° from the current angle.
    this.yawToDeg = this.yawFromDeg + 90 * direction;
    this.yawAnimStartMs = performance.now();
  }

  zoom(direction: 1 | -1): void {
    const next = this.zoomStep + direction;
    if (next < 0 || next >= this.zoomHeights.length) return;
    this.zoomStep = next;
    this.applyFrustum();
  }

  onKeyDown(code: string): void {
    this.keysDown.add(code);
  }

  onKeyUp(code: string): void {
    this.keysDown.delete(code);
  }

  onMouseMove(clientX: number, clientY: number, viewW: number, viewH: number): void {
    // No top-edge pan: the HUD (repo input) lives there, and arrow keys
    // already cover upward panning.
    const band = CAMERA_CONFIG.edgePanBandPx;
    this.edgePanX = clientX < band ? -1 : clientX > viewW - band ? 1 : 0;
    this.edgePanY = clientY > viewH - band ? 1 : 0;
  }

  onMouseLeave(): void {
    this.edgePanX = 0;
    this.edgePanY = 0;
  }

  /** Advance animation + input panning, then position the camera. */
  update(dtSeconds: number, nowMs: number): void {
    // Yaw snap animation.
    if (this.yawAnimStartMs >= 0) {
      const t = (nowMs - this.yawAnimStartMs) / CAMERA_CONFIG.rotateDurationMs;
      if (t >= 1) {
        this.currentYawDeg = this.yawToDeg;
        this.yawAnimStartMs = -1;
        // Normalize so the angle never grows unbounded across many rotations.
        this.yawToDeg = ((this.yawToDeg % 360) + 360) % 360;
        this.currentYawDeg = this.yawToDeg;
        this.yawFromDeg = this.yawToDeg;
      } else {
        const k = easeInOutQuad(t);
        this.currentYawDeg = this.yawFromDeg + (this.yawToDeg - this.yawFromDeg) * k;
      }
    }

    this.applyPan(dtSeconds);
    this.positionCamera();
  }

  private applyPan(dtSeconds: number): void {
    // Zoomed in = slower pan, so on-screen speed feels constant.
    const h0 = this.zoomHeights[0] ?? 1;
    const h = this.zoomHeights[this.zoomStep] ?? h0;
    const zoomScale = h / h0;

    let dx = 0;
    let dy = 0;
    if (this.keysDown.has('ArrowLeft')) dx -= 1;
    if (this.keysDown.has('ArrowRight')) dx += 1;
    if (this.keysDown.has('ArrowUp')) dy -= 1;
    if (this.keysDown.has('ArrowDown')) dy += 1;
    let speed: number = CAMERA_CONFIG.panSpeed;
    if (dx === 0 && dy === 0) {
      dx = this.edgePanX;
      dy = this.edgePanY;
      speed = CAMERA_CONFIG.edgePanSpeed;
    }
    if (dx === 0 && dy === 0) return;

    // Pan in camera-relative screen axes projected onto the ground plane.
    const yawRad = this.currentYawDeg * DEG2RAD;
    // Screen-right on the ground.
    scratchPanDir.set(Math.cos(yawRad), 0, -Math.sin(yawRad)).multiplyScalar(dx);
    // Screen-up on the ground (toward the horizon).
    scratchPanDir.x += -Math.sin(yawRad) * -dy;
    scratchPanDir.z += -Math.cos(yawRad) * -dy;

    const step = speed * zoomScale * dtSeconds;
    this.target.x += scratchPanDir.x * step;
    this.target.z += scratchPanDir.z * step;
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
  }

  private positionCamera(): void {
    const yawRad = this.currentYawDeg * DEG2RAD;
    const pitch = CAMERA_CONFIG.pitchRad;
    const r = CAMERA_CONFIG.orbitRadius;

    scratchOffset.set(
      Math.sin(yawRad) * Math.cos(pitch) * r,
      Math.sin(pitch) * r,
      Math.cos(yawRad) * Math.cos(pitch) * r,
    );

    scratchSnapped.copy(this.target);
    if (CAMERA_CONFIG.pixelSnapEnabled && this.yawAnimStartMs < 0) {
      this.snapTargetToPixelGrid(scratchSnapped, yawRad);
    }

    this.camera.position.copy(scratchSnapped).add(scratchOffset);
    this.camera.lookAt(scratchSnapped);
  }

  /**
   * Quantize the camera target along the camera's right/up axes to whole
   * internal pixels, so world geometry lands on the same texels every frame.
   */
  private snapTargetToPixelGrid(t: THREE.Vector3, yawRad: number): void {
    const frustumHeight = this.zoomHeights[this.zoomStep] ?? 1;
    const frustumWidth = frustumHeight * this.aspect;
    const unitsPerPixel = frustumWidth / this.internalWidth;

    const pitch = CAMERA_CONFIG.pitchRad;
    scratchRight.set(Math.cos(yawRad), 0, -Math.sin(yawRad));
    scratchUp.set(
      -Math.sin(yawRad) * Math.sin(pitch),
      Math.cos(pitch),
      -Math.cos(yawRad) * Math.sin(pitch),
    );

    const rightAmt = t.dot(scratchRight);
    const upAmt = t.dot(scratchUp);
    const rightSnapped = Math.round(rightAmt / unitsPerPixel) * unitsPerPixel;
    const upSnapped = Math.round(upAmt / unitsPerPixel) * unitsPerPixel;

    t.addScaledVector(scratchRight, rightSnapped - rightAmt);
    t.addScaledVector(scratchUp, upSnapped - upAmt);
  }

  private applyFrustum(): void {
    const h = this.zoomHeights[this.zoomStep] ?? 1;
    const w = h * this.aspect;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
  }
}
