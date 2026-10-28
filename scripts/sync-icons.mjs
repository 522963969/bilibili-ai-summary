/**
 * 同步扩展图标：design/icons → public/icons。
 *
 * 图标由设计稿导出（朱红 #e4472b 播放三角 + 字幕线，透明底），
 * 16 / 32 使用「小尺寸优化版」（只保留两条线，避免在 16px 下糊成色块），
 * 48 / 128 使用完整版（三条线）。
 *
 * 这里只做复制与校验，不做缩放：所有尺寸都由设计稿直接导出，
 * 避免运行时插值导致小尺寸发虚。改了设计稿后把对应尺寸重新导出到
 * design/icons，再执行 `npm run icons` 即可。
 */
import { copyFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../design/icons');
const outDir = resolve(here, '../public/icons');

/** 目标文件名 → [源文件, 期望边长] */
const MAPPING = [
  ['icon16.png', 'icon-a-coral-small-16.png', 16],
  ['icon32.png', 'icon-a-coral-small-32.png', 32],
  ['icon48.png', 'icon-a-coral-48.png', 48],
  ['icon128.png', 'icon-a-coral-128.png', 128]
];

function readPngSize(buffer) {
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

if (!existsSync(srcDir)) {
  console.error(`找不到设计稿目录：${srcDir}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

let failed = false;
for (const [target, source, expected] of MAPPING) {
  const sourcePath = resolve(srcDir, source);
  if (!existsSync(sourcePath)) {
    console.error(`缺少源文件：${source}`);
    failed = true;
    continue;
  }
  const size = readPngSize(readFileSync(sourcePath));
  if (!size || size.width !== expected || size.height !== expected) {
    console.error(
      `${source} 尺寸不符：期望 ${expected}x${expected}，实际 ${size ? `${size.width}x${size.height}` : '不是 PNG'}`
    );
    failed = true;
    continue;
  }
  copyFileSync(sourcePath, resolve(outDir, target));
  console.log(`${source} → icons/${target}`);
}

if (failed) process.exit(1);
console.log('图标同步完成');
