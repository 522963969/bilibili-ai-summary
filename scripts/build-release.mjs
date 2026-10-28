/**
 * 产出可直接上传 Chrome 应用商店的安装包。
 *
 * 做三件事：
 *   1. 校验版本号（package.json 与 src/core/config/app.ts 必须一致）
 *   2. 跑一次完整构建（typecheck + vite build），确保 dist 是最新的
 *   3. 把 dist 的内容打到 zip 根目录，并打印体积与 sha256
 *
 * 为什么自己写 ZIP 而不用依赖：这个项目对「不引入额外工具链」有硬要求，
 * 而 zip 是 CPython / Java 都能读的简单格式，deflate + CRC32 就够，
 * 不值得为了一个打包脚本新增 archiver 之类的依赖。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const releaseDir = join(root, 'release');
const skipBuild = process.argv.includes('--skip-build');

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/* ---------- 1. 版本号一致性 ---------- */

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appSource = readFileSync(join(root, 'src/core/config/app.ts'), 'utf8');
const appVersion = appSource.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];

if (!appVersion) fail('在 src/core/config/app.ts 里找不到 APP_VERSION');
if (appVersion !== pkg.version) {
  fail(`版本号不一致：package.json = ${pkg.version}，app.ts = ${appVersion}。请先统一再发布`);
}
if (!/^\d+\.\d+\.\d+$/.test(appVersion)) fail(`版本号 ${appVersion} 不是 x.y.z 格式`);

console.log(`✓ 版本 ${appVersion}（两处一致）`);

/* ---------- 2. 构建 ---------- */

if (skipBuild) {
  console.log('· 跳过构建（--skip-build），直接使用现有 dist/');
} else {
  console.log('· 运行构建…');
  /**
   * Windows 上 npm 是 npm.cmd，Node 从 20.12 起禁止在 shell:false 下启动 .cmd
   * （会直接抛 EINVAL），因此这里必须开 shell。参数是写死的常量，不存在注入面。
   */
  const isWindows = process.platform === 'win32';
  const build = spawnSync(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows
  });
  if (build.error) fail(`构建进程启动失败：${build.error.message}`);
  if (build.status !== 0) fail(`构建失败（退出码 ${build.status}），未生成安装包`);
}

/* ---------- 3. 收集文件 ---------- */

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = walk(distDir).sort();
if (files.length === 0) fail('dist/ 是空的，构建可能没有真正执行');

/** dist 内的相对路径（统一用正斜杠），用于校验 manifest 引用的资源是否真的存在。 */
const relativeNames = new Set(files.map((f) => relative(distDir, f).replace(/\\/g, '/')));

// 打包前的基本体检：商店对这几个文件有硬要求
const manifestPath = join(distDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== pkg.version) {
  fail(`构建产物版本 ${manifest.version} 与 package.json ${pkg.version} 不一致`);
}
for (const size of ['16', '32', '48', '128']) {
  if (!manifest.icons?.[size]) fail(`manifest 缺少 ${size} 尺寸图标`);
}
for (const [size, iconPath] of Object.entries(manifest.icons)) {
  if (!relativeNames.has(iconPath)) fail(`manifest 引用的 ${size} 图标不存在：${iconPath}`);
}
const entryMissing = [
  ...(manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? []),
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  ...(manifest.web_accessible_resources ?? []).flatMap((w) => w.resources ?? [])
].filter((p) => p && !relativeNames.has(p));
if (entryMissing.length > 0) {
  fail(`manifest 引用了不存在的文件：${entryMissing.join(', ')}`);
}

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

/** DOS 时间格式，用固定值让同一个包每次打出来字节一致。 */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of files) {
  const name = relative(distDir, file).replace(/\\/g, '/');
  const raw = readFileSync(file);
  const compressed = deflateRawSync(raw, { level: 9 });
  const useDeflate = compressed.length < raw.length;
  const payload = useDeflate ? compressed : raw;
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // 文件名按 UTF-8 解析
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(raw.length, 22);
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
  central.writeUInt32LE(raw.length, 24);
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
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...localParts, centralBuf, eocd]);

mkdirSync(releaseDir, { recursive: true });
const zipName = `bilibili-ai-summary-${appVersion}.zip`;
const zipPath = join(releaseDir, zipName);
// 旧包留着容易传错，同版本直接覆盖，历史版本由使用者自己归档
rmSync(zipPath, { force: true });
writeFileSync(zipPath, zip);

/* ---------- 5. 汇报 ---------- */

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const totalRaw = files.reduce((sum, f) => sum + statSync(f).size, 0);
const sha256 = createHash('sha256').update(zip).digest('hex');

console.log('\n✓ 安装包已生成');
console.log(`  路径   ${relative(root, zipPath)}`);
console.log(`  文件   ${files.length} 个，原始 ${kb(totalRaw)}，压缩后 ${kb(zip.length)}`);
console.log(`  sha256 ${sha256}`);
console.log('\n上传到 Chrome 应用商店时选这个 zip；本地安装请解压后「加载已解压的扩展程序」。');
