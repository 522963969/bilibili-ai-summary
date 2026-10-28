/**
 * 域名授权策略。
 *
 * 扩展不申请静态的宽泛 host 权限，而是把自定义模型域名交给用户在设置页显式授权：
 * - Base URL 变化时才需要重新授权
 * - 授权范围收敛到单个 origin，而不是全站通配
 * - 首次请求前若未授权，会在界面给出明确提示
 */
export function buildOriginPattern(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.protocol}//${url.hostname}/*`;
}

/** 判断两个 Base URL 是否指向同一授权范围。 */
export function isSameOrigin(a: string, b: string): boolean {
  const patternA = buildOriginPattern(a);
  const patternB = buildOriginPattern(b);
  return patternA !== null && patternA === patternB;
}
