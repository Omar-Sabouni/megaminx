import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EdgeId, EdgeState } from "../core/types";

export const TOP_FACE_COLOR_HEX = "#ffffff" as const;
export const EDGE_SIDE_COLOR_HEX_BY_ID = {
  1: "#cc0000",
  2: "#008000",
  3: "#0066cc",
  4: "#ffd400",
  5: "#800080",
} as const satisfies Record<EdgeId, string>;

const OTHER_FACE_COLOR_HEX = [
  "#ff8c00",
  "#00bcd4",
  "#66aa00",
  "#ff1493",
  "#b5c800",
  "#808080",
] as const;

interface PieceRender {
  group: THREE.Group;
  body: THREE.Mesh;
  topSticker: THREE.Mesh;
  sideSticker: THREE.Mesh;
  sprite: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelContext: CanvasRenderingContext2D;
  labelTexture: THREE.CanvasTexture;
}

interface AnimationFrameData {
  piece: PieceRender;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromRotationY: number;
  toRotationY: number;
}

interface AnimationState {
  start: number;
  durationMs: number;
  frames: AnimationFrameData[];
  resolve: (() => void) | null;
}

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const FACE_STICKER_LIFT = 0.032;
const EDGE_STICKER_LIFT = 0.012;
const EDGE_SLOT_RISE = FACE_STICKER_LIFT - EDGE_STICKER_LIFT;
const FACE_STICKER_OUTER_SCALE = 0.98;
const FACE_STICKER_INNER_SCALE = 0.53;
const FACE_STICKER_CUT_FRACTION = 0.285;
const FACE_STICKER_PIECE_SHRINK = 0.992;

interface DodecaFace {
  normal: THREE.Vector3;
  triangles: number[];
  vertices: THREE.Vector3[];
  center: THREE.Vector3;
}

interface FaceStickerLayout {
  center: THREE.Vector3;
  outerVertices: THREE.Vector3[];
  innerVertices: THREE.Vector3[];
  edgeA: THREE.Vector3[];
  edgeB: THREE.Vector3[];
}

interface FaceTopEdgeMatch {
  localEdgeIndex: number;
  topEdgeIndex: number;
}

const normalizeAngle = (value: number): number => {
  let angle = value;
  while (angle > Math.PI) angle -= TAU;
  while (angle < -Math.PI) angle += TAU;
  return angle;
};

const angleLerp = (from: number, to: number, t: number): number => {
  const diff = normalizeAngle(to - from);
  return from + diff * t;
};

const quantize = (value: number, scale = 10000): number =>
  Math.round(value * scale);

const normalKey = (normal: THREE.Vector3): string =>
  `${quantize(normal.x)},${quantize(normal.y)},${quantize(normal.z)}`;

const positionKey = (position: THREE.Vector3): string =>
  `${quantize(position.x)},${quantize(position.y)},${quantize(position.z)}`;

const averageVector = (vectors: readonly THREE.Vector3[]): THREE.Vector3 => {
  const sum = new THREE.Vector3(0, 0, 0);
  for (const vector of vectors) {
    sum.add(vector);
  }
  return vectors.length > 0 ? sum.multiplyScalar(1 / vectors.length) : sum;
};

const adjacentEdgeIndex = (indices: readonly number[]): number | null => {
  if (indices.length !== 2) {
    return null;
  }
  const [first, second] = [...indices].sort((a, b) => a - b);
  for (let edge = 0; edge < 5; edge += 1) {
    const a = edge;
    const b = (edge + 1) % 5;
    if ((first === a && second === b) || (first === b && second === a)) {
      return edge;
    }
  }
  return null;
};

const ensurePolygonWinding = (
  vertices: THREE.Vector3[],
  normal: THREE.Vector3,
): THREE.Vector3[] => {
  if (vertices.length < 3) {
    return vertices;
  }
  const a = vertices[0];
  const b = vertices[1];
  const c = vertices[2];
  const winding = new THREE.Vector3()
    .crossVectors(b.clone().sub(a), c.clone().sub(a))
    .normalize();
  return winding.dot(normal) < 0 ? [...vertices].reverse() : vertices;
};

const shrinkPolygon = (
  vertices: THREE.Vector3[],
  scale: number,
): THREE.Vector3[] => {
  const centroid = averageVector(vertices);
  return vertices.map((vertex) =>
    centroid.clone().add(vertex.clone().sub(centroid).multiplyScalar(scale)),
  );
};

const convexPolygonGeometry = (
  vertices: THREE.Vector3[],
  normal: THREE.Vector3,
): THREE.BufferGeometry => {
  const oriented = ensurePolygonWinding(vertices, normal);
  const triangles: number[] = [];
  for (let i = 1; i < oriented.length - 1; i += 1) {
    const a = oriented[0];
    const b = oriented[i];
    const c = oriented[i + 1];
    triangles.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(triangles, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
};

const createStickerMaterial = (
  color: string,
  options: {
    flatShading?: boolean;
    roughness?: number;
    metalness?: number;
    polygonOffsetFactor: number;
    polygonOffsetUnits: number;
  },
): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.48,
    metalness: options.metalness ?? 0.02,
    side: THREE.DoubleSide,
    flatShading: options.flatShading ?? false,
    polygonOffset: true,
    polygonOffsetFactor: options.polygonOffsetFactor,
    polygonOffsetUnits: options.polygonOffsetUnits,
  });

const createFaceStickerLayout = (
  vertices: readonly THREE.Vector3[],
): FaceStickerLayout => {
  const center = averageVector(vertices);
  const outerVertices = vertices.map((vertex) =>
    center
      .clone()
      .add(vertex.clone().sub(center).multiplyScalar(FACE_STICKER_OUTER_SCALE)),
  );
  const innerVertices = vertices.map((vertex) =>
    center
      .clone()
      .add(vertex.clone().sub(center).multiplyScalar(FACE_STICKER_INNER_SCALE)),
  );
  const edgeA: THREE.Vector3[] = [];
  const edgeB: THREE.Vector3[] = [];
  for (let index = 0; index < 5; index += 1) {
    const next = (index + 1) % 5;
    edgeA[index] = outerVertices[index]
      .clone()
      .lerp(outerVertices[next], FACE_STICKER_CUT_FRACTION);
    edgeB[index] = outerVertices[index]
      .clone()
      .lerp(outerVertices[next], 1 - FACE_STICKER_CUT_FRACTION);
  }
  return {
    center,
    outerVertices,
    innerVertices,
    edgeA,
    edgeB,
  };
};

const edgeStickerPolygon = (
  layout: FaceStickerLayout,
  edgeIndex: number,
): THREE.Vector3[] => {
  const next = (edgeIndex + 1) % 5;
  return [
    layout.innerVertices[edgeIndex],
    layout.innerVertices[next],
    layout.edgeB[edgeIndex],
    layout.edgeA[edgeIndex],
  ];
};

const cornerStickerPolygon = (
  layout: FaceStickerLayout,
  cornerIndex: number,
): THREE.Vector3[] => {
  const prevEdge = (cornerIndex + 4) % 5;
  return [
    layout.innerVertices[cornerIndex],
    layout.edgeA[cornerIndex],
    layout.outerVertices[cornerIndex],
    layout.edgeB[prevEdge],
  ];
};

const findFaceTopEdgeMatch = (
  face: DodecaFace,
  align: THREE.Quaternion,
  topVertexKeyToIndex: ReadonlyMap<string, number>,
): FaceTopEdgeMatch | null => {
  const sharedLocalIndices: number[] = [];
  const sharedTopIndices: number[] = [];

  for (
    let vertexIndex = 0;
    vertexIndex < face.vertices.length;
    vertexIndex += 1
  ) {
    const key = positionKey(
      face.vertices[vertexIndex].clone().applyQuaternion(align),
    );
    const topIndex = topVertexKeyToIndex.get(key);
    if (topIndex === undefined) {
      continue;
    }
    sharedLocalIndices.push(vertexIndex);
    sharedTopIndices.push(topIndex);
  }

  const localEdgeIndex = adjacentEdgeIndex(sharedLocalIndices);
  const topEdgeIndex = adjacentEdgeIndex(sharedTopIndices);
  if (localEdgeIndex === null || topEdgeIndex === null) {
    return null;
  }

  return { localEdgeIndex, topEdgeIndex };
};

const orderedPentagonVertices = (
  vertices: readonly THREE.Vector3[],
  normal: THREE.Vector3,
): THREE.Vector3[] => {
  const center = averageVector(vertices);
  const fallback = Math.abs(normal.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(normal, fallback).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return [...vertices].sort((a, b) => {
    const ra = a.clone().sub(center);
    const rb = b.clone().sub(center);
    const aa = Math.atan2(ra.dot(v), ra.dot(u));
    const ab = Math.atan2(rb.dot(v), rb.dot(u));
    return aa - ab;
  });
};

const extractDodecaFaces = (radius: number): DodecaFace[] => {
  const sourceGeometry = new THREE.DodecahedronGeometry(radius, 0);
  const geometry = sourceGeometry.index
    ? sourceGeometry.toNonIndexed()
    : sourceGeometry;
  const position = geometry.getAttribute("position");
  const facesByNormal = new Map<
    string,
    {
      normalSum: THREE.Vector3;
      triangles: number[];
      uniqueVertices: Map<string, THREE.Vector3>;
    }
  >();

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const v01 = new THREE.Vector3();
  const v02 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 3) {
    p0.fromBufferAttribute(position, i);
    p1.fromBufferAttribute(position, i + 1);
    p2.fromBufferAttribute(position, i + 2);

    v01.copy(p1).sub(p0);
    v02.copy(p2).sub(p0);
    normal.copy(v01).cross(v02).normalize();

    const key = normalKey(normal);
    const existing = facesByNormal.get(key);
    const record =
      existing ??
      (() => {
        const created = {
          normalSum: new THREE.Vector3(0, 0, 0),
          triangles: [] as number[],
          uniqueVertices: new Map<string, THREE.Vector3>(),
        };
        facesByNormal.set(key, created);
        return created;
      })();

    record.normalSum.add(normal);
    record.triangles.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    record.uniqueVertices.set(positionKey(p0), p0.clone());
    record.uniqueVertices.set(positionKey(p1), p1.clone());
    record.uniqueVertices.set(positionKey(p2), p2.clone());
  }

  const faces: DodecaFace[] = [];
  for (const record of facesByNormal.values()) {
    const faceNormal = record.normalSum.clone().normalize();
    const vertices = Array.from(record.uniqueVertices.values());
    const ordered = orderedPentagonVertices(vertices, faceNormal);
    const center = averageVector(ordered);
    faces.push({
      normal: faceNormal,
      triangles: record.triangles,
      vertices: ordered,
      center,
    });
  }

  faces.sort((a, b) => b.normal.y - a.normal.y);
  geometry.dispose();
  if (geometry !== sourceGeometry) {
    sourceGeometry.dispose();
  }
  return faces;
};

const createLabelResources = (): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  sprite: THREE.Sprite;
} => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not initialize 2D canvas context for labels.");
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(0.86, 0.86, 0.86);
  return { canvas, context, texture, sprite };
};

const drawLabel = (piece: PieceRender, text: string): void => {
  const ctx = piece.labelContext;
  const { width, height } = piece.labelCanvas;
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 92, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#111111";
  ctx.stroke();
  ctx.font = '800 110px Jost, Futura, "Century Gothic", sans-serif';
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2 + 6);
  piece.labelTexture.needsUpdate = true;
};

const slotPosition = (index: number, radius = 1.95): THREE.Vector3 => {
  const angle = -Math.PI / 2 + index * (TAU / 5);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    3.18,
    Math.sin(angle) * radius,
  );
};

export interface SceneTransitionOptions {
  animate?: boolean;
  durationMs?: number;
  respectReducedMotion?: boolean;
}

export interface PuzzleScene<State> {
  setState(state: State, options?: SceneTransitionOptions): Promise<void>;
  resetView(): void;
  dispose(): void;
}

export interface SceneAccessibilityOptions {
  label?: string;
  descriptionId?: string | null;
}

export interface TopLayerSceneOptions {
  canvasLabel?: string;
  canvasDescriptionId?: string | null;
  respectReducedMotion?: boolean;
}

const DEFAULT_CANVAS_LABEL = "Interactive 3D Megaminx top-layer edge model";
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 9.6, 11.7);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 1.1, 0);

export class TopLayerScene implements PuzzleScene<EdgeState> {
  private readonly host: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private readonly lights: THREE.Light[] = [];
  private readonly pieceById = new Map<EdgeId, PieceRender>();
  private slotPositions: THREE.Vector3[] = [];
  private slotYaw: number[] = [];
  private slotTilt: number[] = [];
  private slotInset = 0.37;
  private readonly puzzleGroup = new THREE.Group();
  private animation: AnimationState | null = null;
  private disposed = false;
  private contextLost = false;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private statusElement: HTMLParagraphElement | null = null;
  private hiddenAt: number | null = null;
  private readonly reducedMotionQuery: MediaQueryList | null;
  private readonly respectReducedMotion: boolean;

  constructor(host: HTMLElement, options: TopLayerSceneOptions = {}) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#ffffff");
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    this.camera.position.copy(DEFAULT_CAMERA_POSITION);
    this.camera.lookAt(0, 0.4, 0);
    this.respectReducedMotion = options.respectReducedMotion ?? true;
    this.reducedMotionQuery = this.createReducedMotionQuery();

    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
      });
      this.renderer = renderer;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      host.append(renderer.domElement);
      this.setCanvasAccessibility({
        label: options.canvasLabel ?? DEFAULT_CANVAS_LABEL,
        descriptionId: options.canvasDescriptionId,
      });

      const controls = new OrbitControls(this.camera, renderer.domElement);
      this.controls = controls;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 7;
      controls.maxDistance = 26;
      controls.enablePan = false;
      controls.target.copy(DEFAULT_CAMERA_TARGET);
      controls.update();
      controls.addEventListener("change", this.onControlsChange);

      this.scene.add(this.puzzleGroup);
      this.setupStage();
      this.setupPieces();
    } catch (error: unknown) {
      this.handleInitializationFailure(error);
      return;
    }

    const renderer = this.renderer;
    if (!renderer) {
      return;
    }
    renderer.domElement.addEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("resize", this.resize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(host);
    }
    this.resize();
  }

  private setupStage(): void {
    const ambient = new THREE.AmbientLight("#ffffff", 0.76);
    const key = new THREE.DirectionalLight("#ffffff", 1.02);
    key.position.set(6, 8, 5);
    const fill = new THREE.DirectionalLight("#ffffff", 0.45);
    fill.position.set(-7, 4, -6);
    this.scene.add(ambient, key, fill);
    this.lights.push(ambient, key, fill);

    const bodyRadius = 3.05;
    const stickerRadius = 3.08;
    const stickerLift = FACE_STICKER_LIFT;

    const faces = extractDodecaFaces(stickerRadius);
    if (faces.length === 0) {
      throw new Error("Failed to extract dodecahedron faces.");
    }

    const topFace = faces[0];
    const align = new THREE.Quaternion().setFromUnitVectors(topFace.normal, UP);
    const topOrientedVertices = topFace.vertices.map((vertex) =>
      vertex.clone().applyQuaternion(align),
    );

    const topVertexKeyToIndex = new Map<string, number>();
    topOrientedVertices.forEach((vertex, index) => {
      topVertexKeyToIndex.set(positionKey(vertex), index);
    });

    const faceTopEdgeMatches = new Map<number, FaceTopEdgeMatch>();
    const skipEdgeStickerByFaceIndex = new Map<number, Set<number>>();
    skipEdgeStickerByFaceIndex.set(0, new Set([0, 1, 2, 3, 4]));
    for (let faceIndex = 1; faceIndex < faces.length; faceIndex += 1) {
      const match = findFaceTopEdgeMatch(
        faces[faceIndex],
        align,
        topVertexKeyToIndex,
      );
      if (!match) {
        continue;
      }
      faceTopEdgeMatches.set(faceIndex, match);
      skipEdgeStickerByFaceIndex.set(
        faceIndex,
        new Set([match.localEdgeIndex]),
      );
    }

    const body = new THREE.Mesh(
      new THREE.DodecahedronGeometry(bodyRadius, 0).applyQuaternion(align),
      new THREE.MeshStandardMaterial({
        color: "#111111",
        roughness: 0.78,
        metalness: 0.05,
      }),
    );
    this.puzzleGroup.add(body);

    const faceStickerMaterials: THREE.MeshStandardMaterial[] = [];

    for (let i = 0; i < faces.length; i += 1) {
      const face = faces[i];
      const skipEdges = skipEdgeStickerByFaceIndex.get(i);
      const orientedVertices = face.vertices.map((vertex) =>
        vertex.clone().applyQuaternion(align),
      );
      const orientedNormal = face.normal
        .clone()
        .applyQuaternion(align)
        .normalize();
      const stickerLayout = createFaceStickerLayout(orientedVertices);
      const material = createStickerMaterial("#808080", {
        flatShading: true,
        roughness: 0.56,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      faceStickerMaterials.push(material);

      const liftVector = orientedNormal.clone().multiplyScalar(stickerLift);
      const addSticker = (polygon: THREE.Vector3[]): void => {
        const shrunk = shrinkPolygon(polygon, FACE_STICKER_PIECE_SHRINK);
        const geometry = convexPolygonGeometry(shrunk, orientedNormal);
        const sticker = new THREE.Mesh(geometry, material);
        sticker.position.add(liftVector);
        this.puzzleGroup.add(sticker);
      };

      addSticker(stickerLayout.innerVertices);
      for (let edgeIndex = 0; edgeIndex < 5; edgeIndex += 1) {
        if (skipEdges?.has(edgeIndex)) {
          continue;
        }
        addSticker(edgeStickerPolygon(stickerLayout, edgeIndex));
      }
      for (let cornerIndex = 0; cornerIndex < 5; cornerIndex += 1) {
        addSticker(cornerStickerPolygon(stickerLayout, cornerIndex));
      }
    }

    const orientedVertices = topOrientedVertices;
    const topFaceLayout = createFaceStickerLayout(orientedVertices);
    const faceCenter = topFaceLayout.center;

    const sideFaceByEdge: Array<number | null> = Array.from(
      { length: 5 },
      () => null,
    );
    for (const [faceIndex, match] of faceTopEdgeMatches) {
      sideFaceByEdge[match.topEdgeIndex] = faceIndex;
    }

    const midpoints: THREE.Vector3[] = [];
    const yaws: number[] = [];
    const tilts: number[] = [];
    const insets: number[] = [];

    for (let edgeIndex = 0; edgeIndex < 5; edgeIndex += 1) {
      const v0 = orientedVertices[edgeIndex];
      const v1 = orientedVertices[(edgeIndex + 1) % 5];
      const midpoint = v0.clone().add(v1).multiplyScalar(0.5);
      const topSlotCenter = averageVector(
        edgeStickerPolygon(topFaceLayout, edgeIndex),
      );
      const outward = midpoint.clone().sub(faceCenter).setY(0);
      if (outward.lengthSq() > 1e-8) {
        outward.normalize();
      } else {
        outward.set(0, 0, 1);
      }

      let edgeDir = v1.clone().sub(v0).setY(0);
      if (edgeDir.lengthSq() > 1e-8) {
        edgeDir.normalize();
      } else {
        edgeDir.set(1, 0, 0);
      }

      const zAxis = edgeDir.clone().cross(UP).normalize();
      if (zAxis.dot(outward) < 0) {
        edgeDir.negate();
      }

      const yaw = Math.atan2(-edgeDir.z, edgeDir.x);
      midpoints.push(
        midpoint.clone().add(UP.clone().multiplyScalar(EDGE_SLOT_RISE)),
      );
      yaws.push(yaw);
      insets.push(topSlotCenter.distanceTo(midpoint));

      const sideFaceIndex = sideFaceByEdge[edgeIndex];
      const sideNormal =
        sideFaceIndex !== null
          ? faces[sideFaceIndex].normal
              .clone()
              .applyQuaternion(align)
              .normalize()
          : new THREE.Vector3(0, 0.5, 0.86).normalize();
      const zOut = edgeDir.clone().cross(UP).normalize();
      const tilt = Math.atan2(sideNormal.dot(zOut), sideNormal.dot(UP));
      tilts.push(tilt);
    }

    let startIndex = 0;
    let bestZ = -Infinity;
    for (let i = 0; i < midpoints.length; i += 1) {
      if (midpoints[i].z > bestZ) {
        bestZ = midpoints[i].z;
        startIndex = i;
      }
    }

    this.slotPositions = [];
    this.slotYaw = [];
    this.slotTilt = [];
    for (let i = 0; i < 5; i += 1) {
      const index = (startIndex + i) % 5;
      this.slotPositions.push(midpoints[index]);
      this.slotYaw.push(yaws[index]);
      this.slotTilt.push(tilts[index] ?? Math.PI / 5);
    }
    if (insets.length > 0) {
      this.slotInset =
        insets.reduce((sum, value) => sum + value, 0) / insets.length;
    }

    const faceColorHexByIndex = new Array<string>(faces.length).fill("#808080");
    const lockedFaceIndices = new Set<number>();
    faceColorHexByIndex[0] = TOP_FACE_COLOR_HEX;
    lockedFaceIndices.add(0);

    for (let slot = 0; slot < 5; slot += 1) {
      const edgeIndex = (startIndex + slot) % 5;
      const sideFaceIndex = sideFaceByEdge[edgeIndex];
      if (sideFaceIndex === null) {
        continue;
      }
      const id = (slot + 1) as EdgeId;
      faceColorHexByIndex[sideFaceIndex] = EDGE_SIDE_COLOR_HEX_BY_ID[id];
      lockedFaceIndices.add(sideFaceIndex);
    }

    let otherCursor = 0;
    for (
      let faceIndex = 0;
      faceIndex < faceColorHexByIndex.length;
      faceIndex += 1
    ) {
      if (lockedFaceIndices.has(faceIndex)) {
        continue;
      }
      faceColorHexByIndex[faceIndex] =
        OTHER_FACE_COLOR_HEX[otherCursor % OTHER_FACE_COLOR_HEX.length];
      otherCursor += 1;
    }

    for (
      let faceIndex = 0;
      faceIndex < faceStickerMaterials.length;
      faceIndex += 1
    ) {
      const material = faceStickerMaterials[faceIndex];
      material?.color.set(faceColorHexByIndex[faceIndex] ?? "#808080");
    }
  }

  private setupPieces(): void {
    const coreGeometry = new THREE.BoxGeometry(1.24, 0.22, 0.26);
    const stickerGeometry = new THREE.PlaneGeometry(1.08, 0.42);
    for (const id of [1, 2, 3, 4, 5] as const) {
      const body = new THREE.Mesh(
        coreGeometry,
        new THREE.MeshStandardMaterial({
          color: "#111111",
          roughness: 0.78,
          metalness: 0.07,
        }),
      );

      const topSticker = new THREE.Mesh(
        stickerGeometry,
        createStickerMaterial(TOP_FACE_COLOR_HEX, {
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      topSticker.rotation.x = -Math.PI / 2;

      const sideSticker = new THREE.Mesh(
        stickerGeometry,
        createStickerMaterial(EDGE_SIDE_COLOR_HEX_BY_ID[id], {
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );

      const label = createLabelResources();
      label.sprite.position.set(0, 0.34, 0);

      const group = new THREE.Group();
      group.add(body, topSticker, sideSticker, label.sprite);
      this.puzzleGroup.add(group);

      const renderPiece: PieceRender = {
        group,
        body,
        topSticker,
        sideSticker,
        sprite: label.sprite,
        labelCanvas: label.canvas,
        labelContext: label.context,
        labelTexture: label.texture,
      };
      drawLabel(renderPiece, String(id));
      this.pieceById.set(id, renderPiece);
    }
  }

  private createReducedMotionQuery(): MediaQueryList | null {
    if (typeof window.matchMedia !== "function") {
      return null;
    }
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return null;
    }
  }

  private showSceneStatus(message: string): void {
    const status = this.statusElement ?? document.createElement("p");
    status.dataset.sceneStatus = "true";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = message;
    if (!status.isConnected) {
      this.host.append(status);
    }
    this.statusElement = status;
  }

  private clearSceneStatus(): void {
    this.statusElement?.remove();
    this.statusElement = null;
  }

  private handleInitializationFailure(error: unknown): void {
    const controls = this.controls;
    if (controls) {
      controls.removeEventListener("change", this.onControlsChange);
      controls.dispose();
      this.controls = null;
    }

    this.disposeSceneResources();
    this.scene.clear();
    this.pieceById.clear();

    const renderer = this.renderer;
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      this.renderer = null;
    }

    const detail =
      error instanceof Error && error.message ? ` (${error.message})` : "";
    this.showSceneStatus(
      `The interactive 3D view is unavailable${detail}. Text controls and analysis remain usable.`,
    );
  }

  private readonly onControlsChange = (): void => {
    this.requestRender();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed) {
      return;
    }
    this.contextLost = true;
    this.cancelScheduledRender();
    this.finishAnimation(true);
    this.showSceneStatus(
      "The 3D view is paused while its graphics context recovers. Text controls and analysis remain usable.",
    );
  };

  private readonly onContextRestored = (): void => {
    if (this.disposed) {
      return;
    }
    this.contextLost = false;
    this.clearSceneStatus();
    this.resize();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.hiddenAt = performance.now();
      this.cancelScheduledRender();
      return;
    }

    if (this.hiddenAt !== null && this.animation) {
      this.animation.start += performance.now() - this.hiddenAt;
    }
    this.hiddenAt = null;
    this.requestRender();
  };

  private cancelScheduledRender(): void {
    if (this.rafId === null) {
      return;
    }
    window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private requestRender(): void {
    if (
      this.disposed ||
      this.contextLost ||
      !this.renderer ||
      document.visibilityState === "hidden" ||
      this.rafId !== null
    ) {
      return;
    }
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  private readonly resize = (): void => {
    const renderer = this.renderer;
    if (this.disposed || this.contextLost || !renderer) {
      return;
    }

    const width = Math.max(1, Math.round(this.host.clientWidth));
    const height = Math.max(1, Math.round(this.host.clientHeight));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  };

  private finishAnimation(applyTarget: boolean): void {
    const animation = this.animation;
    if (!animation) {
      return;
    }
    if (applyTarget) {
      for (const frame of animation.frames) {
        frame.piece.group.position.copy(frame.toPosition);
        frame.piece.group.rotation.y = frame.toRotationY;
      }
    }
    this.animation = null;
    animation.resolve?.();
  }

  private readonly tick = (timestamp: number): void => {
    this.rafId = null;
    const renderer = this.renderer;
    if (
      this.disposed ||
      this.contextLost ||
      !renderer ||
      document.visibilityState === "hidden"
    ) {
      return;
    }

    if (this.animation) {
      const elapsed =
        (timestamp - this.animation.start) / this.animation.durationMs;
      const t = Math.min(1, Math.max(0, elapsed));
      for (const frame of this.animation.frames) {
        frame.piece.group.position.lerpVectors(
          frame.fromPosition,
          frame.toPosition,
          t,
        );
        frame.piece.group.rotation.y = angleLerp(
          frame.fromRotationY,
          frame.toRotationY,
          t,
        );
      }
      if (t >= 1) {
        this.finishAnimation(true);
      }
    }

    this.controls?.update();
    renderer.render(this.scene, this.camera);
    if (this.animation) {
      this.requestRender();
    }
  };

  get available(): boolean {
    return !this.disposed && !this.contextLost && this.renderer !== null;
  }

  setCanvasAccessibility(options: SceneAccessibilityOptions): void {
    const canvas = this.renderer?.domElement;
    if (!canvas) {
      return;
    }

    canvas.setAttribute("role", "img");
    if (options.label !== undefined) {
      canvas.setAttribute(
        "aria-label",
        options.label.trim() || DEFAULT_CANVAS_LABEL,
      );
    } else if (!canvas.hasAttribute("aria-label")) {
      canvas.setAttribute("aria-label", DEFAULT_CANVAS_LABEL);
    }

    if (options.descriptionId === null || options.descriptionId === "") {
      canvas.removeAttribute("aria-describedby");
    } else if (options.descriptionId !== undefined) {
      canvas.setAttribute("aria-describedby", options.descriptionId);
    }
  }

  resetView(): void {
    if (this.disposed) {
      return;
    }
    this.camera.position.copy(DEFAULT_CAMERA_POSITION);
    this.camera.up.copy(UP);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    if (this.controls) {
      this.controls.target.copy(DEFAULT_CAMERA_TARGET);
      this.controls.update();
    } else {
      this.camera.lookAt(DEFAULT_CAMERA_TARGET);
    }
    this.requestRender();
  }

  setState(state: EdgeState, options?: SceneTransitionOptions): Promise<void>;
  setState(
    state: EdgeState,
    animate?: boolean,
    durationMs?: number,
  ): Promise<void>;
  setState(
    state: EdgeState,
    animateOrOptions?: boolean | SceneTransitionOptions,
    legacyDurationMs = 260,
  ): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    const options: SceneTransitionOptions =
      typeof animateOrOptions === "object"
        ? animateOrOptions
        : { animate: animateOrOptions ?? true, durationMs: legacyDurationMs };
    const requestedDuration = options.durationMs ?? 260;
    const durationMs = Number.isFinite(requestedDuration)
      ? Math.max(0, requestedDuration)
      : 260;
    const shouldRespectReducedMotion =
      options.respectReducedMotion ?? this.respectReducedMotion;
    const animate =
      (options.animate ?? true) &&
      durationMs > 0 &&
      !(shouldRespectReducedMotion && this.reducedMotionQuery?.matches);

    this.finishAnimation(false);
    const inset = this.slotInset;
    const lift = EDGE_STICKER_LIFT;
    const frames: AnimationFrameData[] = [];
    for (let slot = 0; slot < state.length; slot += 1) {
      const edge = state[slot];
      const piece = this.pieceById.get(edge.id);
      if (!piece) {
        continue;
      }

      const targetPosition = this.slotPositions[slot] ?? slotPosition(slot);
      const baseYaw = this.slotYaw[slot] ?? -slot * (TAU / 5);
      const targetRotationY = baseYaw;
      const tilt = this.slotTilt[slot] ?? Math.PI / 5;
      piece.topSticker.rotation.x = -Math.PI / 2;
      piece.topSticker.position.set(0, lift, -inset);
      piece.sideSticker.rotation.x = -Math.PI / 2 + tilt;
      const sideInDir = new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt));
      const sideNormal = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
      piece.sideSticker.position
        .copy(sideInDir.multiplyScalar(inset))
        .add(sideNormal.multiplyScalar(lift));

      const topMat = piece.topSticker.material;
      const sideMat = piece.sideSticker.material;
      const sideHex = EDGE_SIDE_COLOR_HEX_BY_ID[edge.id] ?? "#808080";
      if (topMat instanceof THREE.MeshStandardMaterial) {
        topMat.color.set(edge.flipped ? sideHex : TOP_FACE_COLOR_HEX);
      }
      if (sideMat instanceof THREE.MeshStandardMaterial) {
        sideMat.color.set(edge.flipped ? TOP_FACE_COLOR_HEX : sideHex);
      }
      drawLabel(piece, edge.flipped ? `${edge.id}'` : `${edge.id}`);

      frames.push({
        piece,
        fromPosition: piece.group.position.clone(),
        toPosition: targetPosition.clone(),
        fromRotationY: piece.group.rotation.y,
        toRotationY: targetRotationY,
      });
    }

    if (!animate || frames.length === 0) {
      for (const frame of frames) {
        frame.piece.group.position.copy(frame.toPosition);
        frame.piece.group.rotation.y = frame.toRotationY;
      }
      this.requestRender();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.animation = {
        start: performance.now(),
        durationMs,
        frames,
        resolve,
      };
      this.requestRender();
    });
  }

  private disposeSceneResources(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    this.scene.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (renderable.geometry instanceof THREE.BufferGeometry) {
        geometries.add(renderable.geometry);
      }
      const objectMaterials = Array.isArray(renderable.material)
        ? renderable.material
        : renderable.material
          ? [renderable.material]
          : [];
      for (const material of objectMaterials) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            textures.add(value);
          }
        }
      }
    });

    for (const piece of this.pieceById.values()) {
      textures.add(piece.labelTexture);
      piece.labelCanvas.width = 1;
      piece.labelCanvas.height = 1;
    }
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.finishAnimation(false);
    this.cancelScheduledRender();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);

    const controls = this.controls;
    if (controls) {
      controls.removeEventListener("change", this.onControlsChange);
      controls.dispose();
      this.controls = null;
    }

    const renderer = this.renderer;
    if (renderer) {
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        this.onContextLost,
      );
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        this.onContextRestored,
      );
    }

    this.disposeSceneResources();
    this.pieceById.clear();
    this.lights.length = 0;
    this.puzzleGroup.clear();
    this.scene.clear();

    if (renderer) {
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      this.renderer = null;
    }
    this.clearSceneStatus();
  }
}
