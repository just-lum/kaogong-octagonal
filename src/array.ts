import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { entries, columns, laneOf, rowOf, type ArchiveEntry } from "./data";

export const LANES = columns.length;
export const ROWS = 8;

/**
 * 环形排布。
 *
 * 四十格沿半径 3.2 m 的圆均匀分布，相邻间距约 0.50 m——此前的 5×8 网格
 * 只有 0.36 m，四十根一起塞进视野里过密。选中项固定在近端点，切换时
 * 环整体转动、相机不动；环的后半圈自然落在视野之外，不必隐藏对象。
 */
export const RING_RADIUS = 3.2;
/** 选中时抬升的高度 */
const SELECT_LIFT = 0.17;

export interface ArrayCell {
  index: number;
  lane: number;
  row: number;
  object: THREE.Group;
  lift: number;
  current: number;
  /** 当前环角（弧度），相对选中项；选中项恒为 0，也就是近端点 */
  angle: number;
  tagTexture?: THREE.Texture;
}

/** 题签纹理：竖排条目名，木牌底。 */
function makeTagTexture(entry: ArchiveEntry, dark = false): THREE.CanvasTexture {
  const W = 160;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 2D 画布，题签纹理生成失败");

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  if (dark) {
    grad.addColorStop(0, "#3a2f22");
    grad.addColorStop(1, "#2b2218");
  } else {
    grad.addColorStop(0, "#d3b98d");
    grad.addColorStop(1, "#bfa271");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = dark ? "rgba(220,200,160,0.35)" : "rgba(62,44,26,0.55)";
  ctx.lineWidth = 5;
  ctx.strokeRect(9, 9, W - 18, H - 18);

  ctx.fillStyle = dark ? "#efe3cc" : "#241a12";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const chars = [...entry.title];
  const size = chars.length > 4 ? 46 : 54;
  ctx.font = `600 ${size}px "Songti SC","Noto Serif SC",serif`;
  const step = Math.min(size * 1.16, (H - 60) / Math.max(1, chars.length));
  const startY = H / 2 - ((chars.length - 1) * step) / 2;
  chars.forEach((ch, i) => ctx.fillText(ch, W / 2, startY + i * step));

  ctx.font = '400 26px "Georgia",serif';
  ctx.fillStyle = dark ? "rgba(230,215,190,0.6)" : "rgba(60,44,28,0.62)";
  ctx.fillText(entry.id.replace("八-", ""), W / 2, H - 30);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * 剑椟阵列：五列 × 八行，每格对应一条档案。
 * 第一版用共享几何的克隆网格；若帧率不足再改 InstancedMesh + 题签图集。
 */
export class CaseArray {
  readonly group = new THREE.Group();

  private readonly cells: ArrayCell[] = [];
  private selected = 0;
  private readonly tagMaterials: THREE.Material[] = [];

  /** 载入剑椟模板并生成四十格。 */
  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const source = gltf.scene ?? gltf.scenes?.[0];
    if (!source) throw new Error("剑椟模型缺少 scene 字段");

    const template: THREE.Mesh[] = [];
    source.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) template.push(mesh);
    });
    if (!template.length) throw new Error("剑鞘模型没有可用网格");

    // 阵列里每格都是大块平直面，正对灯幕时容易整片反白。
    // 这里只压/提环境反射强度；颜色与纹样由模型贴图决定，不在此覆盖。
    for (const mesh of template) {
      const material = mesh.material as THREE.MeshPhysicalMaterial;
      if (!material || !("envMapIntensity" in material)) continue;
      if (material.name.startsWith("sheath_redwood")) {
        // 红木鞘在大块平直面上容易反射成灰粉，压低环境反射保住红棕
        material.envMapIntensity = 0.5;
      } else if (material.name.startsWith("sheath_bronze")) {
        // 铜装靠环境反射出金属感，给足强度
        material.envMapIntensity = 1.15;
      } else if (material.name.startsWith("sheath_wood")) {
        material.envMapIntensity = 0.5;
      }
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const cell = new THREE.Group();
      cell.name = `case-${entry.id}`;

      let tagTexture: THREE.Texture | undefined;
      for (const mesh of template) {
        const isTag = mesh.name === "sheath_tag";
        const material = isTag
          ? new THREE.MeshPhysicalMaterial({
              map: makeTagTexture(entry),
              roughness: 0.6,
              metalness: 0.0,
              clearcoat: 0.15,
            })
          : (mesh.material as THREE.Material);
        if (isTag) {
          this.tagMaterials.push(material);
          tagTexture = (material as THREE.MeshPhysicalMaterial).map ?? undefined;
        }

        const clone = new THREE.Mesh(mesh.geometry, material);
        clone.name = mesh.name;
        clone.position.copy(mesh.position);
        clone.quaternion.copy(mesh.quaternion);
        clone.scale.copy(mesh.scale);
        cell.add(clone);
      }

      const lane = laneOf(index);
      const row = rowOf(index);
      // 位置与朝向由 applySelection / update 按环角布置，这里只定欧拉顺序
      cell.rotation.order = "YXZ";

      // 拾取体：鞘只有 42 mm 宽，射线直打很难命中，套一个不可见但略大的盒子。
      // 材质用透明而非 visible:false —— 后者会被 Raycaster 直接跳过。
      const pickBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.92, 0.11),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      // 鞘的几何沿局部 y 从 +0.024 延伸到 -0.876，盒子对齐它的中段
      pickBox.position.set(0, -0.426, 0);
      pickBox.userData.cellIndex = index;
      cell.add(pickBox);
      this.pickTargets.push(pickBox);

      this.group.add(cell);

      this.cells.push({
        index,
        lane,
        row,
        object: cell,
        lift: 0,
        current: 0,
        angle: 0,
        tagTexture,
      });
    }

    this.applySelection(true);
  }

  get cellCount(): number {
    return this.cells.length;
  }

  /**
   * 该格相对选中项的环角，归一化到 [-π, π] 走最短路径。
   * 不归一化的话，连按方向键会让角度累加，环会绕远路转整圈。
   */
  private ringOffset(index: number): number {
    const step = (Math.PI * 2) / Math.max(1, this.cells.length);
    let offset = (index - this.selected) * step;
    while (offset > Math.PI) offset -= Math.PI * 2;
    while (offset < -Math.PI) offset += Math.PI * 2;
    return offset;
  }

  /** 供射线拾取用的不可见包围盒，每个格子一个 */
  readonly pickTargets: THREE.Mesh[] = [];

  /** 某一格在环上的位置（y 为单元原点；选中项落在近端点） */
  cellPosition(index: number, target = new THREE.Vector3()): THREE.Vector3 {
    const angle = this.ringOffset(index);
    return target.set(
      Math.sin(angle) * RING_RADIUS,
      0,
      Math.cos(angle) * RING_RADIUS,
    );
  }

  /**
   * 选中格**当前的环角**（含转动中的中间值）。
   *
   * 主剑的朝向必须取自这里：鞘的朝向是 `cell.angle + π` 并随环转动更新，
   * 主剑若写死 π，环一转起来两者就错轴，看起来不像从这根鞘里拔出来的。
   */
  selectedCellAngle(): number {
    return this.cells[this.selected]?.angle ?? 0;
  }

  /**
   * 选中格**当前的实际位置**——含抬起的平滑值与波浪偏移。
   *
   * 主剑必须用这个值而不是格位：选中格会抬起 0.17，主剑若留在格位，
   * 柄与剑格会陷进鞘里，剑尖还会从鞘尾穿出去。
   */
  selectedCellPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const cell = this.cells[this.selected];
    if (cell) {
      return target.set(
        cell.object.position.x,
        cell.object.position.y,
        cell.object.position.z,
      );
    }
    return this.cellPosition(this.selected, target);
  }

  get selectedIndex(): number {
    return this.selected;
  }

  select(index: number, animate = true) {
    const next = ((index % this.cells.length) + this.cells.length) % this.cells.length;
    this.selected = next;
    this.applySelection(!animate);
  }

  /**
   * 环形布局下没有"档"这个方向：上下键改为跨卷跳转（±8 格），
   * 保留每卷八条的原有语义。
   */
  stepFile(direction: number, animate = true) {
    this.select(this.selected + direction * ROWS, animate);
  }

  /** 左右键：环转动一格 */
  stepLane(direction: number, animate = true) {
    this.select(this.selected + direction, animate);
  }

  private applySelection(immediate: boolean) {
    for (const cell of this.cells) {
      cell.lift = cell.index === this.selected ? SELECT_LIFT : 0;
      if (immediate) {
        cell.current = cell.lift;
        cell.angle = this.ringOffset(cell.index);
        // 立刻落到环上，避免首帧堆在原点
        cell.object.position.set(
          Math.sin(cell.angle) * RING_RADIUS,
          cell.current,
          Math.cos(cell.angle) * RING_RADIUS,
        );
        cell.object.rotation.set(-Math.PI / 2, cell.angle + Math.PI, 0);
      }
    }
  }

  /** 每帧推进抬升、环角与波浪 */
  update(delta: number, time: number) {
    for (const cell of this.cells) {
      const target = cell.lift;
      // 保留速度的临界阻尼，避免硬切换
      cell.current += (target - cell.current) * Math.min(1, delta * 9.5);
      if (Math.abs(target - cell.current) < 0.0002) cell.current = target;

      // 环角走最短路径逼近目标：切换时整圈转动，选中项始终停在近端点
      const wanted = this.ringOffset(cell.index);
      let diff = wanted - cell.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      cell.angle += diff * Math.min(1, delta * 6.5);
      if (Math.abs(diff) < 0.0008) cell.angle = wanted;

      // 越远离近端点振幅越低，波浪沿环传播
      const wave =
        Math.sin(time * 1.15 - cell.angle * 1.6) *
        0.012 *
        Math.max(0, 1 - Math.abs(cell.angle) * 0.22);

      cell.object.position.set(
        Math.sin(cell.angle) * RING_RADIUS,
        cell.current + wave,
        Math.cos(cell.angle) * RING_RADIUS,
      );
      // 平躺成辐条：先绕 X 放倒（题签随之朝上），再绕竖轴转到所在半径方向。
      // 顺序必须按 "YXZ" 组合，否则会侧翻或倒扣。
      cell.object.rotation.set(-Math.PI / 2, cell.angle + Math.PI, 0);
    }
  }

  dispose() {
    for (const material of this.tagMaterials) {
      const physical = material as THREE.MeshPhysicalMaterial;
      physical.map?.dispose();
      material.dispose();
    }
    this.tagMaterials.length = 0;
    this.cells.length = 0;
  }
}
