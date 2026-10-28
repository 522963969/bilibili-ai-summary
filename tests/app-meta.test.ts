import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from '@/core/config/app';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('应用元信息（发版一致性）', () => {
  it('APP_VERSION 与 package.json 的 version 一致', () => {
    // 版本号在两处各有一份：manifest 走 app.ts，构建产物与 npm 元数据走 package.json。
    // 发版时漏改一处，商店里会出现「安装包版本与页面显示不一致」，这类问题只能靠断言兜住。
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('版本号是合法的 x.y.z', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('商店简介不超过 132 字符', () => {
    // Chrome 的 manifest.description 上限是 132 字符，超了整个包都传不上去
    expect(APP_DESCRIPTION.length).toBeLessThanOrEqual(132);
    expect(APP_DESCRIPTION.length).toBeGreaterThan(20);
  });

  it('简介不宣称尚未实现的功能：宣称的每一项都要有实现文件', () => {
    // 文案可以写功能，但必须真的有对应代码。这条断言在 v1.0.0 之前抓到过一次
    // 「简介写了思维导图 / SVG / PNG，实际没做」——把它改成「有宣称就必须有实现」，
    // 这样以后再加功能不会忘记同步，也不会再出现虚假宣传。
    const exists = (relativePath: string): boolean =>
      existsSync(new URL(`../${relativePath}`, import.meta.url));

    if (APP_DESCRIPTION.includes('思维导图')) {
      expect(exists('src/core/mindmap/svg.ts')).toBe(true);
      expect(exists('src/core/export/mindmap.ts')).toBe(true);
    }
    if (/SVG|PNG/.test(APP_DESCRIPTION)) {
      expect(exists('src/panel/svg-to-png.ts')).toBe(true);
    }
    if (APP_DESCRIPTION.includes('画面识别')) {
      expect(exists('src/core/frames/sampler.ts')).toBe(true);
    }
    if (APP_DESCRIPTION.includes('Markdown')) {
      expect(exists('src/core/export/markdown.ts')).toBe(true);
    }
  });

  it('仍然未实现的能力不出现在简介里', () => {
    // 历史记录、去重、音频转写目前都没做，写进简介就是虚假宣传
    expect(APP_DESCRIPTION).not.toMatch(/历史记录|去重|音频转写|语音转写/);
  });

  it('名称长度符合商店上限 45 字符', () => {
    expect(APP_NAME.length).toBeLessThanOrEqual(45);
    expect(APP_NAME.length).toBeGreaterThan(0);
  });
});
