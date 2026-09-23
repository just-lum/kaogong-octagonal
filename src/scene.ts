import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ink } from "./tokens";
import { CaseArray, RING_RADIUS } from "./array";
import { applyReveal, createRevealUniforms, type RevealUniforms } from "./reveal";
import { QUALITY_PRESETS, type QualitySettings } from "./quality";
import { entries } from "./data";

declare const __MODELS__: Record<string, string>;

/** 生产构建里模型名带内容哈希，开发环境直接用源路径。 */
function modelUrl(key: string): string {
  const map = typeof __MODELS__ === "object" && __MODELS__ ? __MODELS__ : {};
  const file = import.meta.env.DEV ? key : (map[key] ?? key);
  return `${import.meta.env.BASE_URL}${file}`;
}

export type JianPartName =
  | "blade"
  | "guard"
  | "grip"
  | "wrap"
  | "pommel"
  | "scabbard"
  | "slide"
  | "chape";

export interface JianPart {
  name: JianPartName;
  object: THREE.Mesh;
  /** 拆解时的展开方向（原点为装配位置） */
  explode: THREE.Vector3;
}

/**
 * 展柜灯幕：金属的棱线完全依赖「环境是否有方向结构」。
 * 纯色环境会让八个面反射同一片灰、棱线归零（已用对照渲染验证）。
 */
function buildStudioEnvironment(renderer: THREE.WebGLRenderer): {
  texture: THREE.Texture;
  dispose: () => void;
} {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x05060a);

  const trash: { dispose(): void }[] = [];

  const walls: [number, number, number, number][] = [
    [-70, -41, 3.0, 0xccddfd],
    [-41, -12, 2.4, 0xe3eefc],
    [-12, 17, 1.8, 0xfdf7f2],
    [17, 46, 1.3, 0xfff5e6],
    [46, 75, 0.9, 0xffe9d4],
  ];
  for (const [a0, a1, strength, color] of walls) {
    const geometry = new THREE.CylinderGeometry(
      0.9, 0.9, 1.8, 10, 1, true,
      THREE.MathUtils.degToRad(a0),
      THREE.MathUtils.degToRad(a1 - a0),
    );
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(strength),
      side: THREE.DoubleSide,
    });
    envScene.add(new THREE.Mesh(geometry, material));
    trash.push(geometry, material);
  }

  const topGeometry = new THREE.PlaneGeometry(1.7, 1.7);
  const topMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xfff7ec).multiplyScalar(3.0),
  });
  const topLight = new THREE.Mesh(topGeometry, topMaterial);
  topLight.rotation.x = Math.PI / 2;
  topLight.position.y = 0.9;
  envScene.add(topLight);
  trash.push(topGeometry, topMaterial);

  const bottomGeometry = new THREE.PlaneGeometry(1.4, 1.4);
  const bottomMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xdfe6f0).multiplyScalar(0.9),
  });
  const bottomLight = new THREE.Mesh(bottomGeometry, bottomMaterial);
  bottomLight.rotation.x = -Math.PI / 2;
  bottomLight.position.y = -0.9;
  envScene.add(bottomLight);
  trash.push(bottomGeometry, bottomMaterial);

  const target = pmrem.fromScene(envScene, 0.045);
  pmrem.dispose();
  for (const item of trash) item.dispose();

  return { texture: target.texture, dispose: () => target.dispose() };
}

/**
 * 在模型自带材质上做的微调。
 *
 * **不再重建材质**：此前这里用一套手写材质整个替换掉模型材质，
 * 把资产带来的 6 张贴图连同顶点精度一起架空了——模型升了级，画面还是旧材质。
 * 现在只调 envMapIntensity：它决定环境反射的强度，是让八面棱线显形的关键；
 * 颜色、纹样、粗糙度由贴图决定，不该被覆盖。
 */
const ENV_TUNING: Record<JianPartName, number> = {
  blade: 1.9,
  guard: 1.35,
  pommel: 1.35,
  slide: 1.35,
  chape: 1.35,
  scabbard: 0.55,
  grip: 0.9,
  wrap: 0.9,
};

type SceneMode = "array" | "focus" | "detail" | "viewer";

/** 剑身长（与 art/build_jian.py 一致） */
const BLADE_LENGTH = 0.858;
/**
 * 拔出比例：剑身露出部分占剑身长的比例。
 *
 * 0.618 是黄金比例，但它让剑格里离鞘口 530 mm——**超过鞘长的一半**，
 * 画面读起来像"一根细剑身挑着剑格里悬在半空"，而不像从这柄鞘里拔出来。
 * 该值可用 ?ratio=0.35 之类的调试参数覆盖，便于直接对比。
 */
let DRAW_RATIO = 0.618;
/** 装配态剑格里与鞘口齐平的偏移（鞘口在 y=+0.024），护手因此露在鞘外 */
const JIAN_REST_Y = 0.024;

/** 剑相对鞘需要拔出的距离 */
function drawOut(): number {
  return BLADE_LENGTH * DRAW_RATIO;
}

export function setDrawRatio(value: number) {
  DRAW_RATIO = value;
}
/** 查看器里把器物平移到画面中心所需的偏移（剑格里上移 24 mm 后中心在 -0.305） */
const VIEWER_CENTER_Y = 0.305;
/** 剑自带的鞘与鞘饰：阵列单元本身就是鞘，这两者只在查看器里出现 */
const SHEATH_PARTS = new Set<JianPartName>(["scabbard", "slide", "chape"]);

export class ArchiveScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly array = new CaseArray();
  readonly parts = new Map<JianPartName, JianPart>();

  onProgress?: (message: string) => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly disposables: { dispose(): void }[] = [];
  private env?: { texture: THREE.Texture; dispose: () => void };
  private jianRoot?: THREE.Group;
  private hudRoot?: THREE.Group;
  private running = false;
  private raf = 0;
  private mode: SceneMode = "array";
  private explodeAmount = 0;
  private explodeTarget = 0;
  private drawProgress = 0;
  private drawTarget = 0;
  /**
   * 是否已经读取过。
   *
   * 它只决定**换格时要不要自动拔**：
   *
   * | 时机 | 值 | 换格时 |
   * |---|---|---|
   * | 打开页面 | false | 只选取，剑插在鞘中 |
   * | 读取之后 | true | 自动拔出来 |
   * | 刷新页面 | 重置 false | 只选取 |
   *
   * **不写进 localStorage**。写过一次，"上次读过"就留在浏览器里，
   * 重新打开页面一按方向键便自己拔剑——用户的主观状态是"我还没读取"。
   * 那次错的不是"自动拔"这个行为，而是把它持久化了。
   */
  private opened = false;
  /** 待拔标记：跳卷时先等环转到位的中间状态 */
  private pendingDraw = false;
  private pendingSince = 0;
  private readonly revealUniforms: RevealUniforms = createRevealUniforms();

  /** 相机：目标位与当前位置分离，逐帧阻尼插值 */
  private readonly camPos = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private lastWidth = 0;
  private lastHeight = 0;
  private lastDpr = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // 近乎俯瞰后近端距相机约 4.1 m，雾起点必须晚于它，
    // 否则主角自己也被罩上一层灰
    this.scene.fog = new THREE.Fog(0xefe9dc, 4.6, 10.0);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(new THREE.Color(ink.paper), 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 80);
    this.camPos.set(2.6, 2.4, 4.4);
    this.camTarget.set(0, 0.5, 0);
    this.applyCamera();

    this.env = buildStudioEnvironment(this.renderer);
    this.scene.environment = this.env.texture;
    // 金属靠环境反射成像，但玉、木、土沁这类非金属面需要方向光才有亮度。
    // 灯箱本身不产生直接照明，这里补一盏柔和顶光充当展柜射灯。
    const key = new THREE.DirectionalLight(0xfff4e2, 1.5);
    key.position.set(2.4, 6.0, 3.2);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xe6eef7, 0.35);
    fill.position.set(-3.0, 2.2, -2.4);
    this.scene.add(fill);

    this.hudRoot = new THREE.Group();
    this.scene.add(this.hudRoot);
    this.scene.add(this.array.group);
  }

  private applyCamera() {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  /** 按当前模式设定相机期望位，随后由 update 阻尼逼近 */
  private syncCameraTargets() {
    if (this.mode === "array") {
      // 环形阵列：相机在环外正前方，看向近端点一带。取景只覆盖环的约 ±35°，
      // 后半圈自然落在视野之外，不必隐藏对象。
      // 俯瞰环的近端半圈：目标落在环内偏前，视线俯角约 51°。
      // 中央鞘竖直、两侧向外放射——那份放射感来自透视，不是模型倾斜。
      this.desiredTarget.set(0, -0.10, RING_RADIUS - 0.2);
      const distance = this.camera.aspect < 1.05 ? 5.6 : 4.3;
      const dir = new THREE.Vector3(0, 0.78, 0.63).normalize();
      this.desiredPos.copy(this.desiredTarget).addScaledVector(dir, distance);
      return;
    }
    if (this.mode === "viewer") {
      this.updateViewerTargets();
      return;
    }
    // 聚焦到位后的剑身中段：相机只负责构图，剑自身负责升起。
    // 详情模式把器物放画面左侧，右侧留给释文面板。
    // 选中项落在近端点：用它的实际位置对齐取景（含抬升）
    const cell = this.array.selectedCellPosition();
    const portrait = this.camera.aspect < 1.05;
    // 器物横躺、沿半径指向环外，抽出位移也在这条轴上：
    // 取景沿 z 偏移、视线从侧上方看，才看得到全长
    this.desiredTarget.set(cell.x, 0.05, cell.z + drawOut() * 0.4);
    const distance = (this.mode === "detail" ? 2.9 : 2.7) * (portrait ? 1.5 : 1);
    const sideShift = this.mode === "detail" ? 0.32 : -0.16;
    const dir = new THREE.Vector3(0.86, 0.42, sideShift).normalize();
    this.desiredPos.copy(this.desiredTarget).addScaledVector(dir, distance);
  }

  /**
   * 选取另一格：剑落回新格子的鞘中，保持"插着"的形态，**不拔出**。
   *
   * 拔出属于"读取"，不属于"选取"——这两件事此前被我混为一谈，
   * 于是先做出"选中就自动拔"，又改成"根本不会拔"，两头都不对。
   */
  reseat() {
    this.drawProgress = 0;
    this.drawTarget = 0;
  }

  /**
   * 换格之后的收放：**已读取过就自动拔一遍**，否则只是收剑入鞘。
   *
   * 先归零再推出，为的是让"拔"这个过程可见，而不是直接呈现拔好的样子。
   */
  resumeDraw() {
    this.drawProgress = 0;
    this.drawTarget = this.opened ? 1 : 0;
  }

  /**
   * 换格后的收放，但**等环转到位再拔剑**。
   *
   * 转环只转 9°，几乎瞬间到位，用 resumeDraw 即可；跳卷要转 72°，
   * 若立刻推拔出进度，剑会在转动途中被"甩"出来。两者应当都是
   * "环就位 → 剑拔出"，只是跳卷需要等一等。
   */
  deferDraw() {
    this.drawProgress = 0;
    this.drawTarget = 0;
    if (this.opened) {
      this.pendingDraw = true;
      this.pendingSince = performance.now();
    }
  }

  /**
   * 用屏幕坐标拾取环上的某一格，命中返回下标，没命中返回 null。
   *
   * 这是"选取"与"读取"分开的基础：点哪一根就该选中哪一根，
   * 而不是一律对先前选中的那格执行读取。
   */
  pickCell(clientX: number, clientY: number): number | null {
    // 矩阵平时由渲染循环更新；拾取若赶上两帧之间，拿到的就是旧位置，
    // 表现为"同一个点一会儿命中一会儿落空"。这里整棵树强制刷新一次，
    // 让结果只取决于当前的逻辑状态，而不取决于上一次渲染跑没跑过。
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();

    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.array.pickTargets, false);
    if (!hits.length) return null;
    const index = hits[0].object.userData.cellIndex;
    return typeof index === "number" ? index : null;
  }

  setMode(mode: SceneMode) {
    const wasViewer = this.mode === "viewer";
    this.mode = mode;
    // 离开阵列即视为已读取（此后换格会自动拔）；回到阵列则复位。
    // 不复位的话，读取过一次之后每次换格都会自己拔出来，
    // 阵列里就残留了出鞘状态——用户看到的是「插着露柄」才对。
    if (mode === "array") this.opened = false;
    else this.opened = true;
    this.drawTarget = mode === "array" ? 0 : 1;
    const isViewer = mode === "viewer";
    if (isViewer !== wasViewer) this.array.group.visible = !isViewer;
    this.syncCameraTargets();
  }

  // ---------------------------------------------------------------- 查看器
  private viewerAzimuth = 0.42;
  private viewerPolar = 1.30;
  private viewerDistance = 2.5;
  private readonly viewerTarget = new THREE.Vector3(0, 0.02, 0);

  private updateViewerTargets() {
    const sinPolar = Math.sin(this.viewerPolar);
    // 拆解时部件会散开，取景同步退远，避免拆到一半被裁掉
    const distance = this.viewerDistance * (1 + this.explodeAmount * 0.45);
    this.desiredPos.set(
      this.viewerTarget.x + distance * sinPolar * Math.sin(this.viewerAzimuth),
      this.viewerTarget.y + distance * Math.cos(this.viewerPolar),
      this.viewerTarget.z + distance * sinPolar * Math.cos(this.viewerAzimuth),
    );
    this.desiredTarget.copy(this.viewerTarget);
  }

  /** 查看器：拖动改变方位角与极角 */
  orbitBy(deltaAzimuth: number, deltaPolar: number) {
    if (this.mode !== "viewer") return;
    const twoPi = Math.PI * 2;
    // 归一化到 ±π，连续拖动不会绕远路
    this.viewerAzimuth = ((this.viewerAzimuth + deltaAzimuth + Math.PI) % twoPi) - Math.PI;
    this.viewerPolar = THREE.MathUtils.clamp(
      this.viewerPolar + deltaPolar,
      0.16,
      Math.PI - 0.16,
    );
    this.updateViewerTargets();
  }

  /** 查看器：缩放 */
  zoomBy(scale: number) {
    if (this.mode !== "viewer") return;
    this.viewerDistance = THREE.MathUtils.clamp(this.viewerDistance * scale, 0.9, 6.5);
    this.updateViewerTargets();
  }

  /** 查看器：平移取景中心 */
  panBy(dx: number, dy: number) {
    if (this.mode !== "viewer") return;
    const forward = new THREE.Vector3().subVectors(this.camTarget, this.camPos).normalize();
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize();
    this.viewerTarget.addScaledVector(right, dx);
    this.viewerTarget.y = THREE.MathUtils.clamp(this.viewerTarget.y + dy, -0.8, 0.8);
    this.updateViewerTargets();
  }

  /** 查看器：复位走球面短路径 */
  resetView() {
    if (this.mode !== "viewer") return;
    const twoPi = Math.PI * 2;
    const shortest = ((0.42 - this.viewerAzimuth + Math.PI) % twoPi) - Math.PI;
    this.viewerAzimuth += shortest;
    this.viewerPolar = 1.30;
    this.viewerDistance = 2.5;
    this.viewerTarget.set(0, 0.02, 0);
    this.updateViewerTargets();
  }

  /** 选中项变化后重新对准相机（在聚焦模式内切档、切卷时使用） */
  refocus() {
    if (this.mode !== "array") this.syncCameraTargets();
  }

  get sceneMode(): SceneMode {
    return this.mode;
  }

  async load(): Promise<void> {
    this.onProgress?.("载入剑椟…");
    await this.array.load(modelUrl("assets/sheath.glb"));
    this.syncCameraTargets();

    this.onProgress?.("载入器物…");
    await this.loadJian();

    // 主剑在阵列阶段先隐去，抽取时再显现
    if (this.jianRoot) this.jianRoot.visible = false;

    this.camPos.copy(this.desiredPos);
    this.camTarget.copy(this.desiredTarget);
    this.applyCamera();
    this.array.select(2, false);
  }

  private async loadJian(): Promise<void> {
    const response = await fetch(modelUrl("assets/jian.glb"));
    if (!response.ok) throw new Error(`HTTP ${response.status} 剑模型`);
    const buffer = await response.arrayBuffer();

    const loader = new GLTFLoader();
    const gltf = await new Promise<{ scene?: THREE.Object3D; scenes?: THREE.Object3D[] }>(
      (resolve, reject) => {
        loader.parse(buffer, "", resolve as (value: unknown) => void, reject);
      },
    );
    const source = gltf.scene ?? gltf.scenes?.[0];
    if (!source) throw new Error("剑模型缺少 scene 字段");

    // 材质来自模型资产，这里不再创建，也不做整体替换
    const root = new THREE.Group();
    root.name = "jian";

    // 六组拆解。朝向翻转后柄在 +Y、鞘在 -Y，位移方向随之取反。
    const explodeDirections: Record<JianPartName, THREE.Vector3> = {
      pommel: new THREE.Vector3(0, 0.15, 0),
      grip: new THREE.Vector3(0, 0.06, 0.16),
      wrap: new THREE.Vector3(0, 0.06, 0.16),
      guard: new THREE.Vector3(0, 0, 0.25),
      blade: new THREE.Vector3(0, -0.05, 0),
      scabbard: new THREE.Vector3(0.21, 0, -0.02),
      slide: new THREE.Vector3(0.42, 0.20, -0.02),
      chape: new THREE.Vector3(0.42, -0.20, -0.02),
    };

    // 先收集再移动：在 traverse 回调里移出节点会破坏遍历器索引
    const meshes: THREE.Mesh[] = [];
    source.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });

    for (const mesh of meshes) {
      const name = mesh.name as JianPartName;
      if (!(name in ENV_TUNING)) continue;

      // 沿用模型自带的材质：贴图、颜色、粗糙度都由资产决定。
      // 只调环境反射强度，并给剑身挂上拭纹——它改的正是剑身材质本身。
      const material = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as THREE.MeshPhysicalMaterial | undefined;

      if (material && "envMapIntensity" in material) {
        material.envMapIntensity = ENV_TUNING[name];
      }
      if (name === "blade" && material) {
        applyReveal(material, this.revealUniforms);
      }

      root.add(mesh);
      this.parts.set(name, {
        name,
        object: mesh,
        explode: explodeDirections[name] ?? new THREE.Vector3(),
      });
      this.disposables.push(mesh.geometry);
    }

    // 不做居中：剑要保持与鞘一致的原始坐标，装配态的剑格才会正落在鞘口内。
    // 查看器里再另行平移到画面中心。
    const holder = new THREE.Group();
    holder.name = "jianHolder";
    holder.add(root);
    this.jianRoot = holder;
    this.scene.add(holder);
  }

  /** 拆解目标：0 装配，1 完全展开。由 update 平滑推进，可停在中间。 */
  setExplodeTarget(amount: number) {
    this.explodeTarget = THREE.MathUtils.clamp(amount, 0, 1);
  }

  get explode() {
    return this.explodeAmount;
  }

  get explodeIsOpen() {
    return this.explodeTarget > 0.5;
  }

  /** 拭纹进度：0 全土沁，1 全拭净。与正文遮蔽共用同一个值。 */
  setReveal(amount: number) {
    this.revealManual = true;
    this.revealUniforms.uReveal.value = THREE.MathUtils.clamp(amount, 0, 1);
  }

  get reveal(): number {
    return this.revealUniforms.uReveal.value;
  }

  private revealManual = false;
  private lastExplodeForCamera = 0;
  private lastNotifiedReveal = -1;
  /** 拭纹进度变化回调：正文遮蔽条据此同步，保证与三维同帧一致 */
  onRevealChange?: (value: number) => void;

  setJianVisible(visible: boolean) {
    if (this.jianRoot) this.jianRoot.visible = visible;
  }

  setSize(deviceWidth: number, deviceHeight: number, dpr: number) {
    const dprCap = this.quality.dprCap;
    const scale = this.quality.renderScale;
    const effectiveDpr = Math.min(dpr, dprCap);
    const bufferWidth = Math.max(1, Math.round(deviceWidth * scale));
    const bufferHeight = Math.max(1, Math.round(deviceHeight * scale));

    if (
      bufferWidth === this.lastWidth &&
      bufferHeight === this.lastHeight &&
      effectiveDpr === this.lastDpr
    ) {
      return;
    }
    this.lastWidth = bufferWidth;
    this.lastHeight = bufferHeight;
    this.lastDpr = effectiveDpr;

    this.renderer.setPixelRatio(effectiveDpr);
    this.renderer.setSize(bufferWidth, bufferHeight, false);
    // 相机比例按视口算，不按缓冲算：降档只改清晰度，不改构图
    this.camera.aspect = deviceWidth / Math.max(1, deviceHeight);
    this.camera.updateProjectionMatrix();
  }

  /** 切换画质档位：只改渲染缓冲，不动场景内容 */
  setQuality(settings: QualitySettings) {
    this.quality = settings;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.lastDpr = 0;
    this.pendingResize?.();
  }

  get qualitySettings(): QualitySettings {
    return this.quality;
  }

  /** 由入口注入的尺寸重算钩子，档位变化后立即以新尺寸重绘 */
  pendingResize?: () => void;

  private quality: QualitySettings = QUALITY_PRESETS.high;

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.update(this.clock.getElapsedTime());
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private lastTime = 0;

  /** 调试用：加速相机与抽取的收敛，便于在低帧率的无头环境里截图核对 */
  setTimeScale(scale: number) {
    this.timeScale = Math.max(0.05, scale);
  }

  private timeScale = 1;

  private update(time: number) {
    if (document.hidden) return;
    const delta = Math.min(0.05, Math.max(0.001, time - this.lastTime));
    this.lastTime = time;

    this.array.update(delta, time);

    // 拆解进度平滑推进
    this.explodeAmount +=
      (this.explodeTarget - this.explodeAmount) * Math.min(1, delta * 2.2 * this.timeScale);
    if (Math.abs(this.explodeTarget - this.explodeAmount) < 0.001) {
      this.explodeAmount = this.explodeTarget;
    }

    // 待拔：环角收敛之后再推拔出进度，避免"边转边拔"
    if (this.pendingDraw) {
      // 阈值取 2°（0.035 rad）：阻尼是渐近的，等到 0.01 rad 要两三秒，
      // 而肉眼在 2° 以内已看不出环还在转
      const settled = Math.abs(this.array.selectedCellAngle()) < 0.035;
      // 兜底：万一角度因故没收敛，也别一直卡着不拔
      const timedOut = performance.now() - this.pendingSince > 1200;
      if (settled || timedOut) {
        this.pendingDraw = false;
        this.drawProgress = 0;
        this.drawTarget = 1;
      }
    }

    // 抽取进度：剑自匣内升起，匣盖同步开启
    this.drawProgress +=
      (this.drawTarget - this.drawProgress) * Math.min(1, delta * 2.6 * this.timeScale);
    if (Math.abs(this.drawTarget - this.drawProgress) < 0.001) {
      this.drawProgress = this.drawTarget;
    }
    const inViewer = this.mode === "viewer";
    if (this.jianRoot) {
      if (inViewer) {
        // 查看器里器物复位成竖立，并平移到画面中心，六组拆解才有完整器物可拆
        this.jianRoot.position.set(0, VIEWER_CENTER_Y, 0);
        this.jianRoot.rotation.set(0, 0, 0);
        this.jianRoot.visible = true;
      } else {
        // 用选中格的实际位置（含抬起）：选中格抬起 0.17，主剑若留在格位，
        // 柄与剑格会陷进鞘里，剑尖还会从鞘尾穿出。
        const cell = this.array.selectedCellPosition();
        // 与阵列单元同一原点、同一姿态：鞘平躺成辐条，剑必须跟着躺。
        // 抽出分量仍加在部件的局部 y 上，经这层旋转后正好落在半径方向。
        this.jianRoot.position.set(cell.x, cell.y, cell.z);
        // 朝向用选中格的实时角度：鞘那边是 cell.angle + π、随环转动更新，
        // 这里若写死 π，环一转起来剑与鞘就错轴。位置与朝向必须同源。
        this.jianRoot.rotation.order = "YXZ";
        this.jianRoot.rotation.set(
          -Math.PI / 2,
          this.array.selectedCellAngle() + Math.PI,
          0,
        );
        // 剑常驻选中格：插在鞘中（没入鞘内的部分被鞘壁挡住），读取才拔出。
        // 一进页面就有柄，不需要先"读取"一次才出现。
        this.jianRoot.visible = true;
      }

      // 分段节奏：先出鞘一小段，再持续抽出，拭纹最后
      const liftAmount = inViewer
        ? 0
        : THREE.MathUtils.clamp((this.drawProgress - 0.26) / 0.74, 0, 1);
      const lift = liftAmount * drawOut();

      for (const part of this.parts.values()) {
        // 阵列单元本身就是鞘，剑自带的鞘只在查看器里出现
        const ownSheath = SHEATH_PARTS.has(part.name);
        part.object.visible = inViewer || !ownSheath;
        // 非鞘部件整体上移，使剑格里落在鞘口线上、护手露在鞘外；
        // 鞘留在原位，两者的相对位置才正确。
        const rest = ownSheath ? 0 : JIAN_REST_Y;
        part.object.position.set(
          part.explode.x * this.explodeAmount,
          part.explode.y * this.explodeAmount + rest + lift,
          part.explode.z * this.explodeAmount,
        );
      }
    }

    // 拭纹：抽剑过半后开始，与正文遮蔽共用这一个值
    if (!this.revealManual) {
      const target = THREE.MathUtils.clamp((this.drawProgress - 0.55) / 0.45, 0, 1);
      const current = this.revealUniforms.uReveal.value;
      this.revealUniforms.uReveal.value =
        current + (target - current) * Math.min(1, delta * 2.2 * this.timeScale);
    }
    const revealNow = this.revealUniforms.uReveal.value;
    if (Math.abs(revealNow - this.lastNotifiedReveal) > 0.002) {
      this.lastNotifiedReveal = revealNow;
      this.onRevealChange?.(revealNow);
    }

    // 拆解会扩大器物的包围范围，取景距离要跟着走
    if (
      this.mode === "viewer" &&
      Math.abs(this.explodeAmount - this.lastExplodeForCamera) > 0.004
    ) {
      this.lastExplodeForCamera = this.explodeAmount;
      this.updateViewerTargets();
    }

    // 相机阻尼：保留速度的临界阻尼，避免硬切换
    const k = Math.min(1, delta * 3.4 * this.timeScale);
    this.camPos.lerp(this.desiredPos, k);
    this.camTarget.lerp(this.desiredTarget, k);
    this.applyCamera();

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    for (const item of this.disposables) item.dispose();
    // 材质来自模型资产：按实际用到的去重后释放
    const used = new Set<THREE.Material>();
    for (const part of this.parts.values()) {
      const material = part.object.material;
      if (Array.isArray(material)) material.forEach((m) => used.add(m));
      else if (material) used.add(material);
    }
    for (const material of used) material.dispose();
    this.array.dispose();
    this.env?.dispose();
    this.renderer.dispose();
  }

  get canvasElement() {
    return this.canvas;
  }

  get debugInfo(): string {
    const size = this.renderer.getSize(new THREE.Vector2());
    const entry = entries[this.array.selectedIndex];
    const lift =
      this.mode === "viewer"
        ? 0
        : THREE.MathUtils.clamp((this.drawProgress - 0.26) / 0.74, 0, 1) * drawOut();
    const exposed = Math.max(0, lift / BLADE_LENGTH);    return [
      `画布 ${Math.round(size.x)}×${Math.round(size.y)}`,
      `模式 ${this.mode} 抽取 ${this.drawProgress.toFixed(2)}`,
      `剑位移 ${(lift * 1000).toFixed(0)}mm 剑身露出 ${(exposed * 100).toFixed(1)}%`,
      `机位 ${this.camPos.x.toFixed(2)},${this.camPos.y.toFixed(2)},${this.camPos.z.toFixed(2)}`,
      `目标位 ${this.desiredPos.x.toFixed(2)},${this.desiredPos.y.toFixed(2)},${this.desiredPos.z.toFixed(2)}`,
      `视点 ${this.camTarget.x.toFixed(2)},${this.camTarget.y.toFixed(2)},${this.camTarget.z.toFixed(2)}`,
      `目标点 ${this.desiredTarget.x.toFixed(2)},${this.desiredTarget.y.toFixed(2)},${this.desiredTarget.z.toFixed(2)}`,
      `选中 ${entry?.id ?? "?"}`,
    ].join(" · ");
  }
}
