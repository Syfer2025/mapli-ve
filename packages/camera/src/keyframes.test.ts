import { frame, subframe } from "@theatrum/core-time";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_STATE,
  type CameraState,
  cameraKeyframe,
  createCameraTrack,
  evaluateCamera,
  removeCameraKeyframe,
  upsertCameraKeyframe,
} from "./index.js";

const warsaw: CameraState = {
  center: [21, 52],
  zoom: 4,
  bearing: 350,
  pitch: 0,
};

const leningrad: CameraState = {
  center: [30, 60],
  zoom: 8,
  bearing: 10,
  pitch: 40,
};

describe("criação e edição de keyframes", () => {
  it("ordena keyframes e substitui duplicata pela última ocorrência", () => {
    const track = createCameraTrack(DEFAULT_CAMERA_STATE, [
      cameraKeyframe(frame(20), leningrad),
      cameraKeyframe(frame(0), warsaw),
      cameraKeyframe(frame(20), { ...leningrad, zoom: 12 }),
    ]);

    expect(track.keyframes.map((keyframe) => keyframe.frame)).toEqual([frame(0), frame(20)]);
    expect(track.keyframes[1]?.state.zoom).toBe(12);
  });

  it("normaliza default e valores de keyframe ao criar a trilha", () => {
    const track = createCameraTrack({ center: [360, 90], zoom: -1, bearing: -10, pitch: 100 }, [
      {
        frame: frame(0),
        state: { center: [181, -90], zoom: 30, bearing: 370, pitch: -1 },
      },
    ]);

    expect(track.defaultState).toEqual({
      center: [0, 85.051_128_779_806_6],
      zoom: 0,
      bearing: 350,
      pitch: 85,
    });
    expect(track.keyframes[0]?.state).toEqual({
      center: [-179, -85.051_128_779_806_6],
      zoom: 24,
      bearing: 10,
      pitch: 0,
    });
  });

  it("upsert insere ordenado sem mutar a trilha anterior", () => {
    const original = createCameraTrack(warsaw, [cameraKeyframe(frame(20), leningrad)]);
    const inserted = upsertCameraKeyframe(original, cameraKeyframe(frame(10), warsaw));
    const replaced = upsertCameraKeyframe(
      inserted,
      cameraKeyframe(frame(20), { ...leningrad, zoom: 15 }),
    );

    expect(original.keyframes).toHaveLength(1);
    expect(inserted.keyframes.map((keyframe) => keyframe.frame)).toEqual([frame(10), frame(20)]);
    expect(replaced.keyframes).toHaveLength(2);
    expect(replaced.keyframes[1]?.state.zoom).toBe(15);
  });

  it("remove sem mutar e preserva identidade quando nada existe no frame", () => {
    const original = createCameraTrack(warsaw, [
      cameraKeyframe(frame(0), warsaw),
      cameraKeyframe(frame(20), leningrad),
    ]);

    const unchanged = removeCameraKeyframe(original, frame(10));
    const removed = removeCameraKeyframe(original, frame(0));

    expect(unchanged).toBe(original);
    expect(removed).not.toBe(original);
    expect(removed.keyframes).toEqual([original.keyframes[1]]);
    expect(original.keyframes).toHaveLength(2);
  });

  it("rejeita frame persistido negativo, fracionário ou não finito", () => {
    expect(() => cameraKeyframe(frame(-1), warsaw)).toThrow(RangeError);
    expect(() => cameraKeyframe(subframe(1.5), warsaw)).toThrow(RangeError);
    expect(() => cameraKeyframe(subframe(Number.NaN), warsaw)).toThrow(RangeError);
  });
});

describe("evaluateCamera", () => {
  it("usa default apenas quando não há keyframes", () => {
    const track = createCameraTrack(warsaw);
    expect(evaluateCamera(track, frame(0))).toEqual(warsaw);
    expect(evaluateCamera(track, frame(999))).toEqual(warsaw);
  });

  it("mantém o primeiro valor antes da trilha e o último depois dela", () => {
    const track = createCameraTrack(DEFAULT_CAMERA_STATE, [
      cameraKeyframe(frame(10), warsaw),
      cameraKeyframe(frame(20), leningrad),
    ]);

    expect(evaluateCamera(track, frame(0))).toEqual(warsaw);
    expect(evaluateCamera(track, frame(10))).toEqual(warsaw);
    expect(evaluateCamera(track, frame(20))).toEqual(leningrad);
    expect(evaluateCamera(track, frame(30))).toEqual(leningrad);
  });

  it("interpola simultaneamente em frame inteiro e subframe", () => {
    const track = createCameraTrack(DEFAULT_CAMERA_STATE, [
      cameraKeyframe(frame(0), warsaw),
      cameraKeyframe(frame(20), leningrad),
    ]);

    expect(evaluateCamera(track, frame(10))).toEqual({
      center: [25.5, 56],
      zoom: 6,
      bearing: 0,
      pitch: 20,
    });
    const subframeState = evaluateCamera(track, subframe(5.5));
    expect(subframeState.center[0]).toBeCloseTo(23.475, 12);
    expect(subframeState.center[1]).toBeCloseTo(54.2, 12);
    expect(subframeState.zoom).toBeCloseTo(5.1, 12);
    expect(subframeState.bearing).toBeCloseTo(355.5, 12);
    expect(subframeState.pitch).toBeCloseTo(11, 12);
  });

  it("avalia antimeridiano pelo caminho curto", () => {
    const track = createCameraTrack(DEFAULT_CAMERA_STATE, [
      cameraKeyframe(frame(0), { ...warsaw, center: [179, 0] }),
      cameraKeyframe(frame(10), { ...leningrad, center: [-179, 10] }),
    ]);

    expect(evaluateCamera(track, frame(5)).center).toEqual([-180, 5]);
  });

  it("é determinística em acesso direto ou sequencial", () => {
    const track = createCameraTrack(DEFAULT_CAMERA_STATE, [
      cameraKeyframe(frame(0), warsaw),
      cameraKeyframe(frame(500), leningrad),
    ]);

    const direct = evaluateCamera(track, frame(317));
    let sequential = DEFAULT_CAMERA_STATE;
    for (let value = 0; value <= 317; value++) {
      sequential = evaluateCamera(track, frame(value));
    }

    expect(sequential).toEqual(direct);
  });

  it("rejeita frame de avaliação não finito", () => {
    expect(() => evaluateCamera(createCameraTrack(warsaw), subframe(Number.NaN))).toThrow(
      RangeError,
    );
  });
});
