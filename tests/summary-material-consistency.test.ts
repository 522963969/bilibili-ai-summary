import { describe, expect, it } from 'vitest';
import {
  MATERIAL_CHECK_LIMITS,
  checkMaterialConsistency,
  normalizeForCompare,
  type CurrentMaterial
} from '@/core/summary/material-consistency';
import type { SummaryMaterial } from '@/core/summary/types';

/**
 * 「总结不是这个视频的内容」回归测试。
 *
 * 真实反馈：一个讲动漫的视频总结出了汽车内容。这类错误最坑的地方是
 * 结果读起来完全通顺，用户只能靠记忆发现问题。因此这里锁住三件可机械核对的事：
 * 视频键、首句原文、字幕时长；任何一条对不上都必须报出来。
 */

const VIDEO_KEY = 'BV1xx411c7mD#p1';

function makeMaterial(patch: Partial<SummaryMaterial> = {}): SummaryMaterial {
  return {
    videoKey: VIDEO_KEY,
    videoTitle: '某动漫第 3 集',
    cueCount: 4,
    startMs: 0,
    endMs: 240_000,
    firstText: '大家好今天我们来聊一聊这部动画',
    ...patch
  };
}

function makeCurrent(patch: Partial<CurrentMaterial> = {}): CurrentMaterial {
  return {
    source: 'bilibili',
    cueCount: 4,
    totalDurationMs: 240_000,
    texts: ['大家好，今天我们来聊一聊这部动画', '第二句', '第三句', '第四句'],
    ...patch
  };
}

function baseInput() {
  return {
    material: makeMaterial() as SummaryMaterial | undefined,
    currentVideoKey: VIDEO_KEY,
    source: 'subtitle' as const,
    current: makeCurrent() as CurrentMaterial | null,
    videoDurationSeconds: 240
  };
}

describe('normalizeForCompare', () => {
  it('去掉空白与中英文标点，两种来源的字幕可以逐字对上', () => {
    expect(normalizeForCompare('大家好，今天 我们来…')).toBe('大家好今天我们来');
  });
});

describe('checkMaterialConsistency 正常路径', () => {
  it('素材与当前字幕一致时不产生任何告警', () => {
    expect(checkMaterialConsistency(baseInput())).toEqual([]);
  });

  it('首句被截断在句中也能匹配上', () => {
    const long = '这是一句非常长的字幕'.repeat(6);
    const issues = checkMaterialConsistency({
      ...baseInput(),
      // 生成时 firstText 截断到 40 字，当前字幕是完整原文
      material: makeMaterial({ firstText: long.slice(0, 40) }),
      current: makeCurrent({ texts: [long, '第二句'], cueCount: 2 })
    });
    expect(issues.filter((issue) => issue.kind === 'text-not-found')).toHaveLength(0);
  });

  it('字幕条数小幅变化（重取字幕）不报警', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      material: makeMaterial({ cueCount: 200 }),
      current: makeCurrent({ cueCount: 210 })
    });
    expect(issues.map((issue) => issue.kind)).not.toContain('cue-count-drift');
  });
});

describe('checkMaterialConsistency 内容错配', () => {
  it('首句在当前字幕里找不到时判为错误，并指出是哪一句', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      material: makeMaterial({ firstText: '今天我们来试驾这台新车' })
    });
    const issue = issues.find((item) => item.kind === 'text-not-found');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('今天我们来试驾这台新车');
    expect(issue?.action).toBe('refetch-subtitle');
  });

  it('标点不同但文字相同不算错配', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      material: makeMaterial({ firstText: '大家好，今天我们来聊一聊这部动画' }),
      current: makeCurrent({ texts: ['大家好 今天我们来聊一聊这部动画!'] })
    });
    expect(issues.map((issue) => issue.kind)).not.toContain('text-not-found');
  });

  it('已判定首句对不上时不再叠加时长告警，避免一堆红字', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      material: makeMaterial({ firstText: '今天我们来试驾这台新车' }),
      current: makeCurrent({ totalDurationMs: 47 * 60 * 1000 }),
      videoDurationSeconds: 12 * 60
    });
    const kinds = issues.map((issue) => issue.kind);
    expect(kinds).toContain('text-not-found');
    expect(kinds).not.toContain('duration-overflow');
  });

  it('视频键不一致时直接报错', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      material: makeMaterial({ videoKey: 'BV1yy411c7mE#p1' })
    });
    const issue = issues.find((item) => item.kind === 'key-mismatch');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('BV1yy411c7mE#p1');
    expect(issue?.message).toContain(VIDEO_KEY);
  });

  it('字幕条数大幅变化时提示差异比例', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      material: makeMaterial({ cueCount: 200 }),
      current: makeCurrent({ cueCount: 60 })
    });
    const issue = issues.find((item) => item.kind === 'cue-count-drift');
    expect(issue?.level).toBe('warn');
    expect(issue?.message).toContain('200');
    expect(issue?.message).toContain('60');
    expect(issue?.message).toContain('70%');
  });
});

describe('checkMaterialConsistency 时长校验', () => {
  it('字幕总长超过视频时长时判定不是同一个视频', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      current: makeCurrent({ totalDurationMs: 47 * 60 * 1000 }),
      videoDurationSeconds: 12 * 60
    });
    const issue = issues.find((item) => item.kind === 'duration-overflow');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('47:00');
    expect(issue?.message).toContain('12:00');
  });

  it('字幕只覆盖前半段时给出比例，便于判断是不是素材不全', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      current: makeCurrent({ totalDurationMs: 60_000 }),
      videoDurationSeconds: 1_200
    });
    const issue = issues.find((item) => item.kind === 'duration-partial');
    expect(issue?.level).toBe('warn');
    expect(issue?.message).toContain('5%');
  });

  it('短视频不做时长校验，避免旁白稀疏被误判', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      current: makeCurrent({ totalDurationMs: 20_000 }),
      videoDurationSeconds: 60
    });
    expect(issues.map((item) => item.kind)).not.toContain('duration-partial');
    expect(MATERIAL_CHECK_LIMITS.minVideoSeconds).toBe(120);
  });

  it('PV 类视频对白极少时不报「只覆盖前段」', () => {
    // 3.5 分钟的画面向视频只有 8 秒对白，这是正常现象，不该报警
    const issues = checkMaterialConsistency({
      ...baseInput(),
      current: makeCurrent({ totalDurationMs: 8_000 }),
      videoDurationSeconds: 210
    });
    expect(issues).toEqual([]);
    expect(MATERIAL_CHECK_LIMITS.minVideoSecondsForPartial).toBe(300);
  });

  it('拿不到视频时长时跳过时长校验', () => {
    const issues = checkMaterialConsistency({ ...baseInput(), videoDurationSeconds: null });
    expect(issues).toEqual([]);
  });
});

describe('checkMaterialConsistency 导入与画面识别', () => {
  it('素材来自本地导入时显式说明并提供改用平台字幕的动作', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      current: makeCurrent({ source: 'import', importedFileName: '另一部动画.srt' })
    });
    const issue = issues.find((item) => item.kind === 'imported-source');
    expect(issue?.level).toBe('info');
    expect(issue?.message).toContain('另一部动画.srt');
    expect(issue?.action).toBe('refetch-subtitle');
  });

  it('画面识别不做字幕正文与时长比对', () => {
    const issues = checkMaterialConsistency({
      ...baseInput(),
      source: 'frames',
      material: makeMaterial({ firstText: '画面是车内中控台', cueCount: 70 }),
      current: makeCurrent({ cueCount: 4 })
    });
    expect(issues).toEqual([]);
  });

  it('字幕未加载时只核对视频键，不误报正文缺失', () => {
    const issues = checkMaterialConsistency({ ...baseInput(), current: null });
    expect(issues).toEqual([]);
  });

  it('旧快照没有素材指纹时不做正文与条数比对', () => {
    const issues = checkMaterialConsistency({ ...baseInput(), material: undefined });
    expect(issues).toEqual([]);
  });

  it('没有当前视频键时不做键比对（面板尚未识别完）', () => {
    const issues = checkMaterialConsistency({ ...baseInput(), currentVideoKey: null });
    expect(issues).toEqual([]);
  });
});
