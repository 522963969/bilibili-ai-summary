import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/core/config/defaults';
import { SettingsRepository } from '@/core/storage/settings-repository';
import { MemoryStore } from '@/core/storage/store';

function createRepository(): { repository: SettingsRepository; store: MemoryStore } {
  const store = new MemoryStore();
  return { repository: new SettingsRepository(store), store };
}

describe('SettingsRepository', () => {
  it('存储为空时返回默认值，且标记未配置', async () => {
    const { repository } = createRepository();
    const snapshot = await repository.read();
    expect(snapshot.settings.model.baseUrl).toBe(DEFAULT_SETTINGS.model.baseUrl);
    expect(snapshot.modelConfigured).toBe(false);
  });

  it('update 只合并传入的分区，其他分区保持不变', async () => {
    const { repository, store } = createRepository();
    await repository.update({ chunk: { concurrency: 4 } });
    const snapshot = await repository.update({ model: { model: 'deepseek-chat' } });

    expect(snapshot.settings.chunk.concurrency).toBe(4);
    expect(snapshot.settings.model.model).toBe('deepseek-chat');
    expect(snapshot.settings.chunk.maxTokens).toBe(DEFAULT_SETTINGS.chunk.maxTokens);
    expect(await store.get(STORAGE_KEYS.settings)).toBeDefined();
  });

  it('保存后 updatedAt 写入时间戳', async () => {
    const { repository } = createRepository();
    const before = Date.now();
    const snapshot = await repository.update({ general: { theme: 'dark' } });
    expect(snapshot.settings.updatedAt).toBeGreaterThanOrEqual(before);
    expect(snapshot.settings.general.theme).toBe('dark');
  });

  it('保存非法值时返回 issues 并写入收敛后的值', async () => {
    const { repository } = createRepository();
    const result = await repository.update({
      model: { baseUrl: 'ftp://bad-host', temperature: 5 }
    });
    expect(result.settings.model.baseUrl).toBe('');
    expect(result.settings.model.temperature).toBe(2);
    expect(result.issues.length).toBeGreaterThan(0);

    const reloaded = await repository.read();
    expect(reloaded.settings.model.baseUrl).toBe('');
  });

  it('reset 恢复默认值并清空密钥', async () => {
    const { repository } = createRepository();
    await repository.update({ model: { apiKey: 'sk-secret', model: 'x' } });
    const snapshot = await repository.reset();
    expect(snapshot.settings.model.apiKey).toBe('');
    expect(snapshot.settings.model.model).toBe(DEFAULT_SETTINGS.model.model);
    expect(snapshot.modelConfigured).toBe(false);
  });

  it('完整配置后 modelConfigured 为 true', async () => {
    const { repository } = createRepository();
    const snapshot = await repository.update({
      model: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-123',
        model: 'gpt-4o-mini'
      }
    });
    expect(snapshot.modelConfigured).toBe(true);
  });

  it('返回的设置对象与存储解耦（修改返回值不影响存储）', async () => {
    const { repository, store } = createRepository();
    const first = await repository.read();
    first.settings.model.model = 'mutated';
    const stored = await store.get<{ model: { model: string } }>(STORAGE_KEYS.settings);
    expect(stored).toBeUndefined();
    const second = await repository.read();
    expect(second.settings.model.model).toBe(DEFAULT_SETTINGS.model.model);
  });
});
