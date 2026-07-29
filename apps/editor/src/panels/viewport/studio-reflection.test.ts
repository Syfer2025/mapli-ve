/**
 * Provas do espelho planar do palco ([ADR-018](../../../../../docs/adr/ADR-018-studio-planar-floor-reflection.md)).
 *
 * O shader é provado no Electron real. Aqui ficam as propriedades que não
 * precisam de GPU: reflexão da câmera, ordem matriz/clip, orçamento do target e
 * restauração transacional do estado do Three.
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  REFLECTION_MAX_SIDE_PX,
  createStudioReflectionProjector,
  obliqueFloorProjection,
  reflectAcrossStudioFloor,
  reflectCameraPoseAcrossStudioFloor,
  reflectionSamplingMatrix,
  reflectionTargetSize,
  type ReflectionCameraPose,
} from "./studio-reflection.js";

function expectTupleClose(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
): void {
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index] ?? Number.NaN, 9);
  }
}

function expectMatrixClose(actual: THREE.Matrix4, expected: THREE.Matrix4): void {
  actual.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.elements[index] ?? Number.NaN, 9);
  });
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.2, 600);
  camera.position.set(4, 7, 13);
  camera.up.set(0, 1, 0);
  camera.lookAt(1, 1.5, -2);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function worldPose(camera: THREE.PerspectiveCamera): ReflectionCameraPose {
  camera.updateMatrixWorld();
  const position = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);
  const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).add(position);
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rotation);
  return {
    position: [position.x, position.y, position.z],
    lookAt: [lookAt.x, lookAt.y, lookAt.z],
    up: [up.x, up.y, up.z],
  };
}

function cameraFromPose(
  source: THREE.PerspectiveCamera,
  pose: ReflectionCameraPose,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.fromArray(pose.position);
  camera.up.fromArray(pose.up);
  camera.lookAt(...pose.lookAt);
  camera.projectionMatrix.copy(source.projectionMatrix);
  camera.projectionMatrixInverse.copy(source.projectionMatrixInverse);
  camera.near = source.near;
  camera.far = source.far;
  camera.updateMatrixWorld();
  return camera;
}

function ndc(point: readonly [number, number, number], camera: THREE.Camera): THREE.Vector3 {
  return new THREE.Vector3(...point).project(camera);
}

interface FakeRendererControl {
  readonly renderer: THREE.WebGLRenderer;
  readonly previousTarget: THREE.WebGLRenderTarget;
  readonly originalViewport: THREE.Vector4;
  readonly originalScissor: THREE.Vector4;
  readonly originalClear: THREE.Color;
  readonly originalCubeFace: number;
  readonly originalMipmapLevel: number;
  readonly depthMask: ReturnType<typeof vi.fn>;
  readonly colorMask: ReturnType<typeof vi.fn>;
  readonly render: ReturnType<typeof vi.fn>;
  currentTarget: THREE.WebGLRenderTarget | null;
  currentCubeFace: number;
  currentMipmapLevel: number;
  currentViewport: THREE.Vector4;
  currentScissor: THREE.Vector4;
  currentScissorTest: boolean;
  currentClear: THREE.Color;
  currentClearAlpha: number;
  onRender: ((scene: THREE.Scene, camera: THREE.Camera) => void) | null;
}

function fakeRenderer(pixelRatio = 2): FakeRendererControl {
  const previousTarget = new THREE.WebGLRenderTarget(17, 13);
  const originalViewport = new THREE.Vector4(3, 4, 501, 302);
  const originalScissor = new THREE.Vector4(7, 8, 211, 109);
  const originalClear = new THREE.Color("#29405a");
  const originalCubeFace = 4;
  const originalMipmapLevel = 3;
  const control = {
    previousTarget,
    originalViewport,
    originalScissor,
    originalClear,
    originalCubeFace,
    originalMipmapLevel,
    currentTarget: previousTarget as THREE.WebGLRenderTarget | null,
    currentCubeFace: originalCubeFace,
    currentMipmapLevel: originalMipmapLevel,
    currentViewport: originalViewport.clone(),
    currentScissor: originalScissor.clone(),
    currentScissorTest: true,
    currentClear: originalClear.clone(),
    currentClearAlpha: 0.37,
    currentDepthMask: false,
    currentColorMask: false,
    onRender: null as ((scene: THREE.Scene, camera: THREE.Camera) => void) | null,
  };
  const depthMask = vi.fn((enabled: boolean) => {
    control.currentDepthMask = enabled;
  });
  const colorMask = vi.fn((enabled: boolean) => {
    control.currentColorMask = enabled;
  });
  const context = {
    DEPTH_WRITEMASK: 0x0b72,
    COLOR_WRITEMASK: 0x0c23,
    getParameter: (parameter: number) =>
      parameter === 0x0b72
        ? control.currentDepthMask
        : [
            control.currentColorMask,
            control.currentColorMask,
            control.currentColorMask,
            control.currentColorMask,
          ],
  } as unknown as WebGL2RenderingContext;
  const render = vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
    control.onRender?.(scene, camera);
  });
  const assignRect = (
    current: THREE.Vector4,
    x: THREE.Vector4 | number,
    y?: number,
    width?: number,
    height?: number,
  ): void => {
    if (x instanceof THREE.Vector4) {
      current.copy(x);
      return;
    }
    current.set(x, y ?? 0, width ?? 0, height ?? 0);
  };
  const renderer = {
    autoClear: true,
    xr: { enabled: true },
    shadowMap: { autoUpdate: true },
    state: {
      buffers: {
        depth: { setMask: depthMask },
        color: { setMask: colorMask },
      },
    },
    getContext: () => context,
    getPixelRatio: () => pixelRatio,
    getRenderTarget: () => control.currentTarget,
    getActiveCubeFace: () => control.currentCubeFace,
    getActiveMipmapLevel: () => control.currentMipmapLevel,
    setRenderTarget: (
      target: THREE.WebGLRenderTarget | null,
      activeCubeFace = 0,
      activeMipmapLevel = 0,
    ) => {
      control.currentTarget = target;
      control.currentCubeFace = activeCubeFace;
      control.currentMipmapLevel = activeMipmapLevel;
    },
    getViewport: (target: THREE.Vector4) => target.copy(control.currentViewport),
    setViewport: (x: THREE.Vector4 | number, y?: number, width?: number, height?: number) =>
      assignRect(control.currentViewport, x, y, width, height),
    getScissor: (target: THREE.Vector4) => target.copy(control.currentScissor),
    setScissor: (x: THREE.Vector4 | number, y?: number, width?: number, height?: number) =>
      assignRect(control.currentScissor, x, y, width, height),
    getScissorTest: () => control.currentScissorTest,
    setScissorTest: (enabled: boolean) => {
      control.currentScissorTest = enabled;
    },
    getClearColor: (target: THREE.Color) => target.copy(control.currentClear),
    setClearColor: (color: THREE.ColorRepresentation, alpha?: number) => {
      control.currentClear.set(color);
      if (alpha !== undefined) control.currentClearAlpha = alpha;
    },
    getClearAlpha: () => control.currentClearAlpha,
    clear: vi.fn(),
    render,
  } as unknown as THREE.WebGLRenderer;
  return Object.assign(control, { renderer, depthMask, colorMask, render });
}

describe("reflexão no plano do piso", () => {
  it("espelha posição, direção e up e é sua própria inversa", () => {
    const pose: ReflectionCameraPose = {
      position: [4, 7, 13],
      lookAt: [1, 1.5, -2],
      up: [0.1, 0.9, -0.2],
    };
    const reflected = reflectCameraPoseAcrossStudioFloor(pose);
    expectTupleClose(reflected.position, [4, -7, 13]);
    expectTupleClose(reflected.lookAt, [1, -1.5, -2]);
    expectTupleClose(reflected.up, [0.1, -0.9, -0.2]);
    const twice = reflectCameraPoseAcrossStudioFloor(reflected);
    expectTupleClose(twice.position, pose.position);
    expectTupleClose(twice.lookAt, pose.lookAt);
    expectTupleClose(twice.up, pose.up);
  });

  it("um ponto do piso preserva Y e troca a orientação horizontal no espelho", () => {
    const source = makeCamera();
    const reflected = cameraFromPose(source, reflectCameraPoseAcrossStudioFloor(worldPose(source)));
    for (const point of [
      [0, 0, 0],
      [7, 0, -4],
      [-3, 0, 6],
    ] as const) {
      const real = ndc(point, source);
      const mirror = ndc(point, reflected);
      // Refletir forward e up produz uma base left-handed. `lookAt` reconstrói
      // uma câmera right-handed trocando o eixo X, como faz o Reflector.js.
      expect(mirror.x).toBeCloseTo(-real.x, 9);
      expect(mirror.y).toBeCloseTo(real.y, 9);
    }
  });

  it("a câmera espelhada vê o espelho do objeto com X invertido", () => {
    const source = makeCamera();
    const reflected = cameraFromPose(source, reflectCameraPoseAcrossStudioFloor(worldPose(source)));
    const object: readonly [number, number, number] = [2, 3, -1];
    const fromMirror = ndc(object, reflected);
    const mirroredObject = ndc(reflectAcrossStudioFloor(object), source);
    expect(fromMirror.x).toBeCloseTo(-mirroredObject.x, 9);
    expect(fromMirror.y).toBeCloseTo(mirroredObject.y, 9);
    expect(fromMirror.z).toBeCloseTo(mirroredObject.z, 9);
  });

  it("o clip oblíquo é finito, não altera entradas e corta o lado sob o piso", () => {
    const source = makeCamera();
    const reflected = cameraFromPose(source, reflectCameraPoseAcrossStudioFloor(worldPose(source)));
    const originalProjection = source.projectionMatrix.clone();
    const originalView = reflected.matrixWorldInverse.clone();
    const clipped = obliqueFloorProjection(source.projectionMatrix, reflected.matrixWorldInverse);
    expect(clipped).not.toBeNull();
    expectMatrixClose(source.projectionMatrix, originalProjection);
    expectMatrixClose(reflected.matrixWorldInverse, originalView);
    expect(clipped?.elements.every((value) => Number.isFinite(value))).toBe(true);
    if (clipped === null) return;

    const clipPoint = (point: readonly [number, number, number]): THREE.Vector4 =>
      new THREE.Vector4(...point, 1)
        .applyMatrix4(reflected.matrixWorldInverse)
        .applyMatrix4(clipped);
    const above = clipPoint([0, 1, 0]);
    const below = clipPoint([0, -1, 0]);
    expect(above.z).toBeGreaterThanOrEqual(-above.w - 1e-8);
    expect(below.z).toBeLessThan(-below.w);
  });
});

describe("orçamento do target", () => {
  it("usa metade do tamanho físico enquanto cabe no teto", () => {
    expect(reflectionTargetSize(800, 600, 2)).toEqual({ width: 800, height: 600 });
    expect(reflectionTargetSize(320, 180, 1)).toEqual({ width: 160, height: 90 });
  });

  it("preserva aspecto e limita o maior lado a 1024", () => {
    const size = reflectionTargetSize(1920, 1080, 2);
    expect(size.width).toBe(REFLECTION_MAX_SIDE_PX);
    expect(size.height).toBe(576);
    expect(size.width / size.height).toBeCloseTo(16 / 9, 3);
  });

  it("entrada degenerada nunca produz target zero ou não finito", () => {
    for (const size of [
      reflectionTargetSize(0, 0, 0),
      reflectionTargetSize(Number.NaN, Infinity, Number.NaN),
      reflectionTargetSize(-10, -20, -2),
    ]) {
      expect(size.width).toBeGreaterThanOrEqual(1);
      expect(size.height).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(size.width)).toBe(true);
      expect(Number.isFinite(size.height)).toBe(true);
    }
  });
});

describe("StudioReflectionProjector", () => {
  it("renderiza HDR RGBA com depth e restaura todo estado tocado", () => {
    const projector = createStudioReflectionProjector();
    const fake = fakeRenderer(2);
    const scene = new THREE.Scene();
    const background = new THREE.Color("#182330");
    const override = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    scene.background = background;
    scene.overrideMaterial = override;
    const visible = new THREE.Object3D();
    const alreadyHidden = new THREE.Object3D();
    alreadyHidden.visible = false;
    const captured: {
      camera: THREE.PerspectiveCamera | undefined;
      target: THREE.WebGLRenderTarget | undefined;
    } = { camera: undefined, target: undefined };
    fake.onRender = (renderedScene, camera) => {
      captured.camera = camera as THREE.PerspectiveCamera;
      captured.target = fake.currentTarget ?? undefined;
      expect(renderedScene).toBe(scene);
      expect(fake.currentTarget).not.toBe(fake.previousTarget);
      expect(fake.currentCubeFace).toBe(0);
      expect(fake.currentMipmapLevel).toBe(0);
      expect(fake.currentViewport.toArray()).toEqual([0, 0, 800, 600]);
      expect(fake.currentScissor.toArray()).toEqual([0, 0, 800, 600]);
      expect(fake.currentScissorTest).toBe(false);
      expect(fake.currentClear.getHex()).toBe(0);
      expect(fake.currentClearAlpha).toBe(0);
      expect(fake.renderer.autoClear).toBe(false);
      expect(fake.renderer.xr.enabled).toBe(false);
      expect(fake.renderer.shadowMap.autoUpdate).toBe(false);
      expect(scene.background).toBeNull();
      expect(scene.overrideMaterial).toBeNull();
      expect(visible.visible).toBe(false);
      expect(alreadyHidden.visible).toBe(false);
    };

    const source = makeCamera();
    const result = projector.update(
      fake.renderer,
      scene,
      source,
      [visible, alreadyHidden],
      800,
      600,
    );
    expect(result).not.toBeNull();
    expect(result?.width).toBe(800);
    expect(result?.height).toBe(600);
    expect(result?.texelSize.x).toBeCloseTo(1 / 800, 12);
    expect(result?.texelSize.y).toBeCloseTo(1 / 600, 12);
    expect(result?.texture.format).toBe(THREE.RGBAFormat);
    expect(result?.texture.type).toBe(THREE.HalfFloatType);
    expect(result?.texture.minFilter).toBe(THREE.LinearFilter);
    expect(result?.texture.magFilter).toBe(THREE.LinearFilter);
    expect(captured.target?.depthBuffer).toBe(true);
    expect(captured.target?.stencilBuffer).toBe(false);
    expect(fake.depthMask).toHaveBeenCalledWith(true);
    expect(fake.colorMask).toHaveBeenCalledWith(true);

    // A matriz pública usa a projeção original. A câmera entregue ao renderer já
    // contém a terceira linha alterada pelo clip.
    expect(captured.camera).toBeDefined();
    if (result !== null && captured.camera !== undefined) {
      expectMatrixClose(
        result.matrix,
        reflectionSamplingMatrix(source.projectionMatrix, captured.camera.matrixWorldInverse),
      );
      const clippedSampling = reflectionSamplingMatrix(
        captured.camera.projectionMatrix,
        captured.camera.matrixWorldInverse,
      );
      expect(result.matrix.equals(clippedSampling)).toBe(false);
    }

    expect(fake.currentTarget).toBe(fake.previousTarget);
    expect(fake.currentCubeFace).toBe(fake.originalCubeFace);
    expect(fake.currentMipmapLevel).toBe(fake.originalMipmapLevel);
    expect(fake.currentViewport.equals(fake.originalViewport)).toBe(true);
    expect(fake.currentScissor.equals(fake.originalScissor)).toBe(true);
    expect(fake.currentScissorTest).toBe(true);
    expect(fake.currentClear.equals(fake.originalClear)).toBe(true);
    expect(fake.currentClearAlpha).toBeCloseTo(0.37, 12);
    expect(fake.renderer.autoClear).toBe(true);
    expect(fake.renderer.xr.enabled).toBe(true);
    expect(fake.renderer.shadowMap.autoUpdate).toBe(true);
    expect(fake.depthMask).toHaveBeenLastCalledWith(false);
    expect(fake.colorMask).toHaveBeenLastCalledWith(false);
    expect(scene.background).toBe(background);
    expect(scene.overrideMaterial).toBe(override);
    expect(visible.visible).toBe(true);
    expect(alreadyHidden.visible).toBe(false);
    expect(projector.status()).toEqual({ renders: 1, width: 800, height: 600 });

    projector.dispose();
    override.dispose();
    fake.previousTarget.dispose();
  });

  it("a guarda reentrante impede um segundo passe sobre o target ativo", () => {
    const projector = createStudioReflectionProjector();
    const fake = fakeRenderer();
    const scene = new THREE.Scene();
    const camera = makeCamera();
    let nested: ReturnType<typeof projector.update> | undefined;
    fake.onRender = () => {
      nested = projector.update(fake.renderer, scene, camera, [], 640, 360);
    };
    const result = projector.update(fake.renderer, scene, camera, [], 640, 360);
    expect(result).not.toBeNull();
    expect(nested).toBeNull();
    expect(fake.render).toHaveBeenCalledTimes(1);
    expect(projector.status().renders).toBe(1);
    projector.dispose();
    fake.previousTarget.dispose();
  });

  it("restaura estado e libera a guarda mesmo quando render lança", () => {
    const projector = createStudioReflectionProjector();
    const fake = fakeRenderer();
    const scene = new THREE.Scene();
    const background = new THREE.Color("#223344");
    const override = new THREE.MeshBasicMaterial();
    scene.background = background;
    scene.overrideMaterial = override;
    const hidden = new THREE.Object3D();
    fake.onRender = () => {
      throw new Error("GPU simulada");
    };
    expect(() => projector.update(fake.renderer, scene, makeCamera(), [hidden], 640, 360)).toThrow(
      "GPU simulada",
    );

    expect(fake.currentTarget).toBe(fake.previousTarget);
    expect(fake.currentCubeFace).toBe(fake.originalCubeFace);
    expect(fake.currentMipmapLevel).toBe(fake.originalMipmapLevel);
    expect(fake.currentViewport.equals(fake.originalViewport)).toBe(true);
    expect(fake.currentScissor.equals(fake.originalScissor)).toBe(true);
    expect(fake.currentScissorTest).toBe(true);
    expect(fake.currentClear.equals(fake.originalClear)).toBe(true);
    expect(fake.currentClearAlpha).toBeCloseTo(0.37, 12);
    expect(fake.renderer.autoClear).toBe(true);
    expect(fake.renderer.xr.enabled).toBe(true);
    expect(fake.renderer.shadowMap.autoUpdate).toBe(true);
    expect(fake.depthMask).toHaveBeenLastCalledWith(false);
    expect(fake.colorMask).toHaveBeenLastCalledWith(false);
    expect(scene.background).toBe(background);
    expect(scene.overrideMaterial).toBe(override);
    expect(hidden.visible).toBe(true);
    expect(projector.status().renders).toBe(0);

    // Se `rendering` tivesse vazado, esta segunda chamada voltaria `null`.
    fake.onRender = null;
    expect(projector.update(fake.renderer, scene, makeCamera(), [hidden], 640, 360)).not.toBeNull();
    expect(projector.status().renders).toBe(1);
    projector.dispose();
    override.dispose();
    fake.previousTarget.dispose();
  });

  it("não renderiza sob o piso, não realoca no mesmo tamanho e dispose é idempotente", () => {
    const projector = createStudioReflectionProjector();
    const fake = fakeRenderer();
    const scene = new THREE.Scene();
    const below = makeCamera();
    below.position.y = -1;
    below.updateMatrixWorld();
    expect(projector.update(fake.renderer, scene, below, [], 640, 360)).toBeNull();
    expect(fake.render).not.toHaveBeenCalled();
    expect(projector.status()).toEqual({ renders: 0, width: 0, height: 0 });

    let target: THREE.WebGLRenderTarget | null = null;
    fake.onRender = () => {
      target = fake.currentTarget;
    };
    const camera = makeCamera();
    expect(projector.update(fake.renderer, scene, camera, [], 640, 360)).not.toBeNull();
    expect(target).not.toBeNull();
    if (target === null) return;
    const resize = vi.spyOn(target, "setSize");
    expect(projector.update(fake.renderer, scene, camera, [], 640, 360)).not.toBeNull();
    expect(resize).not.toHaveBeenCalled();
    const dispose = vi.spyOn(target, "dispose");
    projector.dispose();
    projector.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(projector.update(fake.renderer, scene, camera, [], 640, 360)).toBeNull();
    expect(fake.render).toHaveBeenCalledTimes(2);
    fake.previousTarget.dispose();
  });
});
