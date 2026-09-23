// 内容校验：条数、编号唯一性、部位键合法、来源非空、每卷条数。
// 任一不满足即失败并指出具体条目，不静默通过。
// 用法：node scripts/check-content.mjs
import { readFileSync } from "node:fs";

const SECTIONS = ["剑身", "剑格", "缑柄", "剑首", "鞘身", "鞘饰"];
const PER_COLUMN = 8;

const path = "content/entries.json";
let data;
try {
  data = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(`✗ ${path} 无法解析：${error.message}`);
  process.exit(1);
}

const errors = [];
const { columns, records } = data ?? {};

if (!Array.isArray(columns) || columns.length !== 5) {
  errors.push(`columns 必须是 5 卷，当前 ${Array.isArray(columns) ? columns.length : "缺失"}`);
}
if (!Array.isArray(records)) {
  errors.push("records 缺失或不是数组");
}

const list = Array.isArray(records) ? records : [];

if (list.length !== 40) {
  errors.push(`条目数应为 40，当前 ${list.length}`);
}

const seenIds = new Set();
const perCategory = new Map();

list.forEach((record, index) => {
  const where = `records[${index}] ${record?.id ?? "(无编号)"}`;

  if (!record || typeof record !== "object") {
    errors.push(`${where}：不是对象`);
    return;
  }
  if (!record.id) errors.push(`${where}：缺少 id`);
  else if (seenIds.has(record.id)) errors.push(`${where}：id 重复`);
  else seenIds.add(record.id);

  if (!record.title) errors.push(`${where}：缺少 title`);
  if (!record.en) errors.push(`${where}：缺少 en`);
  if (!SECTIONS.includes(record.section)) {
    errors.push(`${where}：section「${record.section}」不在允许值 ${SECTIONS.join("/")}`);
  }
  if (!Array.isArray(columns) || !columns.includes(record.category)) {
    errors.push(`${where}：category「${record.category}」不在 columns 内`);
  }
  if (!record.status) errors.push(`${where}：缺少 status`);
  if (typeof record.abstract !== "string" || record.abstract.length < 20) {
    errors.push(`${where}：abstract 过短或缺失`);
  }
  if (!Array.isArray(record.findings) || record.findings.length < 1) {
    errors.push(`${where}：findings 缺失`);
  }
  if (typeof record.source !== "string" || !/^https?:\/\//.test(record.source)) {
    errors.push(`${where}：source 缺失或不是 URL`);
  }

  perCategory.set(record.category, (perCategory.get(record.category) ?? 0) + 1);
});

if (Array.isArray(columns)) {
  for (const column of columns) {
    const count = perCategory.get(column) ?? 0;
    if (count !== PER_COLUMN) {
      errors.push(`卷「${column}」应有 ${PER_COLUMN} 条，当前 ${count} 条`);
    }
  }
}

// 部位键分布：六组拆解都要有内容对应，否则聚焦与拭纹会落空
const sectionUse = new Map(SECTIONS.map((key) => [key, 0]));
list.forEach((record) => {
  if (sectionUse.has(record.section)) {
    sectionUse.set(record.section, sectionUse.get(record.section) + 1);
  }
});

if (errors.length) {
  console.error(`✗ 内容校验未通过（${errors.length} 项）`);
  for (const message of errors) console.error(`  · ${message}`);
  process.exit(1);
}

console.log(`✓ 内容校验通过：${list.length} 条 / ${columns.length} 卷`);
console.log(
  "  部位分布：" +
    SECTIONS.map((key) => `${key} ${sectionUse.get(key)}`).join("  ·  "),
);
