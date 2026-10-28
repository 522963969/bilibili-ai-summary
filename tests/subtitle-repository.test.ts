import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/core/config/defaults';
import { SubtitleRepository } from '@/core/storage/subtitle-repository';
import { MemoryStore } from '@/core/storage/store';
import { buildNormalizedSubtitle } from '@/core/subtitle/normalize';
import { readSubtitleFile } from '@/core/subtitle/file-input';
import type { NormalizedSubtitle } from '@/core/subtitle/types';

function makeSubtitle(overrides: Partial<NormalizedSubtitle> = {}): NormalizedSubtitle {
  return {
    ...buildNormalizedSubtitle({
      videoKey: 'BV1xx411c7mD#p1',
      trackId: 'sub-1',
      lang: 'zh-CN',
      label: '中文（自动生成）',
      source: 'bilibili',
      format: 'bilibili-json',
      rawCues: [
        { startMs: 0, endMs: 1200, text: '你好' },
        { startMs: 1500, endMs: 3000, text: '世界' }
      ],
      now: 1700000000000
    }),
    ...overrides
  };
}

describe('SubtitleRepository', () => {
  it('保存后可按视频键读取', async () => {
    const store = new MemoryStore();
    const repository = new SubtitleRepository(store);
    const subtitle = makeSubtitle();

    await repository.save(subtitle);
    const loaded = await repository.read(subtitle.videoKey);
    expect(loaded?.cues).toHaveLength(2);
    expect(loaded?.stats.cueCount).toBe(2);
    expect(await store.get(`${STORAGE_KEYS.subtitlePrefix}${subtitle.videoKey}`)).toBeDefined();
  });

  it('未缓存时返回 null', async () => {
    const repository = new SubtitleRepository(new MemoryStore());
    expect(await repository.read('unknown#p1')).toBeNull();
  });

  it('结构损坏的数据被视为未缓存并被清理', async () => {
    const store = new MemoryStore({
      [`${STORAGE_KEYS.subtitlePrefix}bad#p1`]: { videoKey: 'bad#p1', cues: 'not-array' }
    });
    const repository = new SubtitleRepository(store);
    expect(await repository.read('bad#p1')).toBeNull();
    expect(await store.get(`${STORAGE_KEYS.subtitlePrefix}bad#p1`)).toBeUndefined();
  });

  it('remove 与 listVideoKeys 生效', async () => {
    const repository = new SubtitleRepository(new MemoryStore());
    await repository.save(makeSubtitle({ videoKey: 'A#p1' }));
    await repository.save(makeSubtitle({ videoKey: 'B#p2' }));
    expect(await repository.listVideoKeys()).toEqual(['A#p1', 'B#p2']);

    await repository.remove('A#p1');
    expect(await repository.read('A#p1')).toBeNull();
    expect(await repository.listVideoKeys()).toEqual(['B#p2']);
  });
});

function fileFromBytes(bytes: Uint8Array, name = 'demo.srt'): File {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  } as unknown as File;
}

describe('readSubtitleFile', () => {
  it('UTF-8 内容原样返回', async () => {
    const bytes = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\n中文测试');
    expect(await readSubtitleFile(fileFromBytes(bytes))).toContain('中文测试');
  });

  it('GBK 内容回退解码为正确字符', async () => {
    // "中文" 的 GBK 编码：D6 D0 CE C4
    const bytes = new Uint8Array([0x31, 0x0a, 0xd6, 0xd0, 0xce, 0xc4]);
    const text = await readSubtitleFile(fileFromBytes(bytes));
    expect(text).toContain('中文');
  });

  it('带 BOM 的 UTF-8 不产生替换字符', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x42]);
    const text = await readSubtitleFile(fileFromBytes(bytes));
    expect(text).not.toContain('\uFFFD');
    expect(text.trim()).toBe('AB');
  });
});
