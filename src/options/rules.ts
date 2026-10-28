import type { FormRules } from 'element-plus';
import { SETTINGS_LIMITS } from '@/core/config/defaults';
import { normalizeBaseUrl } from '@/core/settings/normalize';
import type { ExtensionSettings } from '@/core/settings/types';

type ValidateCallback = (error?: string | Error) => void;

/**
 * 表单校验规则。
 * 通过 getForm 读取当前表单值，用于跨字段约束（目标块大小 <= 最大块大小）。
 */
export function createSettingsRules(getForm: () => ExtensionSettings): FormRules {
  return {
    'model.baseUrl': [
      {
        validator: (_rule: unknown, value: unknown, callback: ValidateCallback) => {
          const raw = typeof value === 'string' ? value : '';
          if (raw.trim().length === 0) {
            callback(new Error('请填写 Base URL'));
            return;
          }
          const result = normalizeBaseUrl(raw);
          if (result.error) {
            callback(new Error(result.error));
            return;
          }
          callback();
        },
        trigger: 'blur'
      }
    ],
    'model.model': [{ required: true, message: '请填写模型名称', trigger: 'blur' }],
    'model.apiKey': [],
    'chunk.targetTokens': [
      {
        validator: (_rule: unknown, value: unknown, callback: ValidateCallback) => {
          const target = typeof value === 'number' ? value : Number.NaN;
          if (!Number.isFinite(target)) {
            callback(new Error('请输入目标块大小'));
            return;
          }
          if (target < SETTINGS_LIMITS.targetTokens.min || target > SETTINGS_LIMITS.targetTokens.max) {
            callback(
              new Error(
                `目标块大小需在 ${SETTINGS_LIMITS.targetTokens.min}–${SETTINGS_LIMITS.targetTokens.max} 之间`
              )
            );
            return;
          }
          if (target > getForm().chunk.maxTokens) {
            callback(new Error('目标块大小不能大于最大块大小'));
            return;
          }
          callback();
        },
        trigger: 'change'
      }
    ],
    'chunk.maxTokens': [
      {
        validator: (_rule: unknown, value: unknown, callback: ValidateCallback) => {
          const max = typeof value === 'number' ? value : Number.NaN;
          if (!Number.isFinite(max)) {
            callback(new Error('请输入最大块大小'));
            return;
          }
          if (max < getForm().chunk.targetTokens) {
            callback(new Error('最大块大小不能小于目标块大小'));
            return;
          }
          callback();
        },
        trigger: 'change'
      }
    ]
  };
}
