import * as THREE from 'three';

// --- Retro pipeline tuning -------------------------------------------------
export const RETRO_CONFIG = {
  /** Internal render height, px. Width follows the window aspect. */
  internalHeight: 360,
  /** Allowed internal width range; chosen once at startup from the aspect. */
  internalWidthMin: 640,
  internalWidthMax: 800,
  /** Bits kept per color channel in the palette crunch (5 ≈ 32k colors). */
  bitsPerChannel: 5,
  /** Strength of the 4x4 ordered Bayer dither, in quantization steps. */
  ditherAmplitude: 0.9,
  /** Saturation multiplier applied before quantizing. 1995 liked it vivid. */
  saturationBoost: 1.18,
} as const;

/**
 * Bypass switch: when true the scene renders modern-style (full resolution,
 * no quantization, no dither) for before/after screenshots. Toggle key: B.
 */
export const retroBypass = { enabled: false };

// 4x4 Bayer matrix, values 0..15, normalized in the shader.
const BAYER_4X4 = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);

const CRUNCH_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const CRUNCH_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uLevels;      // quantization levels per channel (2^bits - 1)
uniform float uDitherAmp;   // dither strength in quantization steps
uniform float uSaturation;  // saturation multiplier before quantizing
uniform float uBayer[16];
varying vec2 vUv;

void main() {
  vec3 color = texture2D(uScene, vUv).rgb;

  // Saturation lean: push away from luma.
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = clamp(mix(vec3(luma), color, uSaturation), 0.0, 1.0);

  // Ordered 4x4 Bayer dither in internal-pixel space.
  ivec2 px = ivec2(mod(vUv * uResolution, 4.0));
  float threshold = uBayer[px.y * 4 + px.x] / 16.0 - 0.5;
  color += threshold * (uDitherAmp / uLevels);

  // Palette crunch to N bits per channel.
  color = floor(color * uLevels + 0.5) / uLevels;

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Owns the low-res render target and the crunch/dither blit pass.
 * Call render() instead of renderer.render().
 */
export class RetroPipeline {
  readonly internalWidth: number;
  readonly internalHeight: number;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly crunchScene = new THREE.Scene();
  private readonly crunchCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly crunchMaterial: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, windowAspect: number) {
    this.renderer = renderer;
    this.internalHeight = RETRO_CONFIG.internalHeight;
    this.internalWidth = Math.round(
      THREE.MathUtils.clamp(
        this.internalHeight * windowAspect,
        RETRO_CONFIG.internalWidthMin,
        RETRO_CONFIG.internalWidthMax,
      ),
    );

    this.target = new THREE.WebGLRenderTarget(this.internalWidth, this.internalHeight, {
      // Nearest magnification is what makes the blit chunky instead of blurry.
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });

    const levels = 2 ** RETRO_CONFIG.bitsPerChannel - 1;
    this.crunchMaterial = new THREE.ShaderMaterial({
      vertexShader: CRUNCH_VERTEX,
      fragmentShader: CRUNCH_FRAGMENT,
      uniforms: {
        uScene: { value: this.target.texture },
        uResolution: { value: new THREE.Vector2(this.internalWidth, this.internalHeight) },
        uLevels: { value: levels },
        uDitherAmp: { value: RETRO_CONFIG.ditherAmplitude },
        uSaturation: { value: RETRO_CONFIG.saturationBoost },
        uBayer: { value: BAYER_4X4 },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Fullscreen triangle-pair; positions already in clip space (see vertex shader).
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.crunchMaterial);
    quad.frustumCulled = false;
    this.crunchScene.add(quad);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (retroBypass.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.crunchScene, this.crunchCamera);
  }
}
