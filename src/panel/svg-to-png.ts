/**
 * 把 SVG 字符串栅格化成 PNG（base64）。
 *
 * 为什么要在面板里做：`canvas.toBlob` 只能在有 DOM 的环境里跑，Service Worker 没有
 * `document`；而面板又是跨源 iframe，自己发起下载会被浏览器取消。
 * 因此分工是「面板画图 → 页面顶层文档下载」。
 *
 * 已知限制：SVG 里不能有 foreignObject 或外部资源，否则 Chromium 会画出空白。
 * 我们的导图只用 rect / path / text，满足这个前提。
 */
export interface RasterizeOptions {
  /** 放大倍数，2 倍在高分屏上不发虚 */
  scale?: number;
  /** 背景色，必须显式填充：canvas 默认透明，深色站点上会看不见字 */
  background?: string;
}

export async function svgToPngBase64(
  svg: string,
  width: number,
  height: number,
  options: RasterizeOptions = {}
): Promise<string> {
  const scale = options.scale ?? 2;
  const background = options.background ?? '#ffffff';

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('导图渲染失败，无法转成图片'));
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持 canvas 导出');

    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error('图片编码失败');
    return dataUrl.slice(comma + 1);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
