import { describe, expect, it } from 'vitest';
import { estimateTokens, planChunks, renderCues } from '@/core/summary/chunk-planner';
import type { SubtitleCue } from '@/core/subtitle/types';

function makeCues(count: number, stepMs = 3000, text = '这是一句用于测试分块的字幕内容'): SubtitleCue[] {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    startMs: index * stepMs,
    endMs: index * stepMs + stepMs - 500,
    text
  }));
}

const BASE = { targetTokens: 600, maxTokens: 800, overlapSeconds: 10 };

describe('estimateTokens', () => {
  it('中文按字计、英文按 4 字符计', () => {
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('中文abcd')).toBe(3);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('renderCues', () => {
  it('每行带 mm:ss 前缀，便于模型定位时间', () => {
    const text = renderCues([
      { index: 1, startMs: 0, endMs: 2000, text: '开场' },
      { index: 2, startMs: 65_000, endMs: 70_000, text: '第二段' }
    ]);
    expect(text).toBe('[00:00] 开场\n[01:05] 第二段');
  });
});

describe('planChunks', () => {
  it('空字幕返回空计划', () => {
    const plan = planChunks([], BASE);
    expect(plan.chunks).toHaveLength(0);
    expect(plan.estimatedTotalTokens).toBe(0);
  });

  it('短字幕只生成一块，覆盖完整时间范围', () => {
    const cues = makeCues(3);
    const plan = planChunks(cues, BASE);
    expect(plan.chunks).toHaveLength(1);
    const chunk = plan.chunks[0];
    expect(chunk?.startMs).toBe(0);
    expect(chunk?.endMs).toBe(cues[2]?.endMs);
    expect(chunk?.cueCount).toBe(3);
  });

  it('长字幕切分为多块，且单块不超过上限', () => {
    const cues = makeCues(120);
    const plan = planChunks(cues, BASE);
    expect(plan.chunks.length).toBeGreaterThan(1);
    for (const chunk of plan.chunks) {
      expect(chunk.estimatedTokens).toBeLessThanOrEqual(BASE.maxTokens);
    }
  });

  it('相邻块之间存在时间重叠', () => {
    const cues = makeCues(120);
    const plan = planChunks(cues, BASE);
    const first = plan.chunks[0];
    const second = plan.chunks[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;
    expect(second.startMs).toBeLessThan(first.endMs);
    expect(plan.overlappedCues).toBeGreaterThan(0);
  });

  it('重叠为 0 时块之间不重复', () => {
    const cues = makeCues(120);
    const plan = planChunks(cues, { ...BASE, overlapSeconds: 0 });
    const first = plan.chunks[0];
    const second = plan.chunks[1];
    if (!first || !second) return;
    expect(second.startMs).toBeGreaterThanOrEqual(first.endMs);
    expect(plan.overlappedCues).toBe(0);
  });

  it('块索引连续递增，且总块数受上限约束', () => {
    const cues = makeCues(400);
    const plan = planChunks(cues, { targetTokens: 200, maxTokens: 300, overlapSeconds: 30 });
    plan.chunks.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
    });
    expect(plan.chunks.length).toBeLessThanOrEqual(200);
  });

  it('单条超长字幕不会产生空块或死循环', () => {
    const long: SubtitleCue[] = [
      { index: 1, startMs: 0, endMs: 1000, text: '很长的字幕'.repeat(2000) },
      { index: 2, startMs: 1000, endMs: 2000, text: '结尾' }
    ];
    const plan = planChunks(long, { targetTokens: 100, maxTokens: 120, overlapSeconds: 30 });
    expect(plan.chunks.length).toBeGreaterThan(0);
    expect(plan.chunks.every((chunk) => chunk.cueCount > 0)).toBe(true);
  });
});
