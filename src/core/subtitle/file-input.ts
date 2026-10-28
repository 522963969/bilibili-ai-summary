/**
 * 读取用户选择的字幕文件。
 * 中文 SRT 常见 GBK 编码，这里在 UTF-8 解码出现替换字符时回退 GBK，
 * 并选择替换字符更少的结果，避免整篇乱码。
 */
export async function readSubtitleFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (!utf8.includes('\uFFFD')) return utf8;

  try {
    const gbk = new TextDecoder('gbk', { fatal: false }).decode(buffer);
    const gbkBroken = (gbk.match(/\uFFFD/g) ?? []).length;
    const utf8Broken = (utf8.match(/\uFFFD/g) ?? []).length;
    return gbkBroken < utf8Broken ? gbk : utf8;
  } catch {
    return utf8;
  }
}
