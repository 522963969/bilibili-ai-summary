/**
 * 产出「发给别人就能用」的离线分享包。
 *
 * 与 build-release.mjs 的区别：
 *   - release/*.zip      只装扩展本体，提交商店用，接收方拿不到任何说明
 *   - release/*-share.zip 扩展本体 + START-HERE.html，直接发给个人用
 *
 * 结构刻意做成「解压出来的那一层就是扩展目录」：
 *   bilibili-ai-summary-<version>/
 *     START-HERE.html      ← 双击看说明
 *     manifest.json        ← 这一层直接「加载已解压的扩展程序」
 *     assets/ icons/ src/ service-worker-loader.js
 * 少一层嵌套，就少一次「选错文件夹 → 提示清单文件缺失」的来回。
 */
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const releaseDir = join(root, 'release');
const templatePath = join(root, 'share/START-HERE.html');
const README_NAME = 'START-HERE.html';

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/* ---------- 1. 版本与产物校验 ---------- */

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8'));
} catch {
  fail('读不到 dist/manifest.json，请先执行 npm run build');
}
if (manifest.version !== version) {
  fail(`dist 版本 ${manifest.version} 与 package.json ${version} 不一致，请重新构建`);
}

/* ---------- 2. 收集扩展文件 ---------- */

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const extFiles = walk(distDir).sort();
if (extFiles.length === 0) fail('dist/ 是空的');

const extNames = new Set(extFiles.map((f) => relative(distDir, f).replace(/\\/g, '/')));
if (extNames.has(README_NAME)) {
  fail(`dist/ 里已经有 ${README_NAME}，会和说明文件冲突`);
}

/* ---------- 3. 生成说明页 ---------- */

const template = readFileSync(templatePath, 'utf8');
if (!template.includes('{{VERSION}}')) fail('说明模板缺少 {{VERSION}} 占位符');
const readmeHtml = template.replaceAll('{{VERSION}}', version);
const readmeBuf = Buffer.from(readmeHtml, 'utf8');

/* ---------- 4. 写 ZIP ---------- */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** 条目列表：说明页放最前，方便解压工具里先看到它。 */
const entries = [
  { name: README_NAME, raw: readmeBuf },
  ...extFiles.map((f) => ({ name: relative(distDir, f).replace(/\\/g, '/'), raw: readFileSync(f) }))
];

const localParts = [];
const centralParts = [];
let offset = 0;

for (const entry of entries) {
  const compressed = deflateRawSync(entry.raw, { level: 9 });
  const useDeflate = compressed.length < entry.raw.length;
  const payload = useDeflate ? compressed : entry.raw;
  const nameBuf = Buffer.from(entry.name, 'utf8');
  const crc = crc32(entry.raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // 文件名按 UTF-8 解析
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(entry.raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  localParts.push(local, nameBuf, payload);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(entry.raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0o644 << 16, 38);
  central.writeUInt32LE(offset, 42);

  centralParts.push(central, nameBuf);
  offset += local.length + nameBuf.length + payload.length;
}

const centralBuf = Buffer.concat(centralParts);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...localParts, centralBuf, eocd]);

mkdirSync(releaseDir, { recursive: true });
const zipPath = join(releaseDir, `bilibili-ai-summary-${version}-share.zip`);
rmSync(zipPath, { force: true });
writeFileSync(zipPath, zip);

/* ---------- 5. 汇报 ---------- */

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const totalRaw = entries.reduce((sum, e) => sum + e.raw.length, 0);
const sha256 = createHash('sha256').update(zip).digest('hex');

console.log('\n✓ 分享包已生成');
console.log(`  路径   ${relative(root, zipPath)}`);
console.log(`  内容   扩展 ${extFiles.length} 个文件 + ${README_NAME}`);
console.log(`  体积   原始 ${kb(totalRaw)}，压缩后 ${kb(zip.length)}`);
console.log(`  sha256 ${sha256}`);
console.log('\n发给别人时连 zip 一起说明：解压 → 浏览器加载这个文件夹 → 填自己的模型 Key。');
