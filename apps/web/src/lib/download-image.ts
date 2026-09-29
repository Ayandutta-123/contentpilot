/** Parse intrinsic size from SVG markup (width/height or viewBox). */
function parseSvgSize(svgText: string): { width: number; height: number } | null {
  const vb = svgText.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (vb) {
    const w = Number(vb[3]);
    const h = Number(vb[4]);
    if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
  }
  const wAttr = svgText.match(/\bwidth=["'](\d+(?:\.\d+)?)(px)?["']/i);
  const hAttr = svgText.match(/\bheight=["'](\d+(?:\.\d+)?)(px)?["']/i);
  if (wAttr && hAttr) {
    const w = Number(wAttr[1]);
    const h = Number(hAttr[1]);
    if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
  }
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for export'));
    img.src = src;
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

async function rasterizeToPng(
  imageSrc: string,
  width: number,
  height: number,
  scale = 1,
): Promise<Blob> {
  const img = await loadImage(imageSrc);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))),
      'image/png',
      1,
    );
  });
}

/**
 * Download at full native resolution as PNG (SVG is rasterized; raster files re-exported as PNG).
 * `scale` > 1 upscales for print / Retina (e.g. 2 = 2× pixels).
 */
export async function downloadImageHighQuality(
  src: string,
  filenameBase: string,
  opts?: { scale?: number },
): Promise<void> {
  const scale = opts?.scale && opts.scale > 0 ? opts.scale : 1;
  const safeName = (filenameBase || 'post-image')
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  const outName = `${safeName}${scale > 1 ? `@${scale}x` : ''}.png`;

  const res = await fetch(src, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to fetch image');
  const blob = await res.blob();
  const isSvg =
    blob.type.includes('svg') ||
    src.toLowerCase().includes('.svg') ||
    (await blob.slice(0, 200).text()).trimStart().startsWith('<svg');

  if (isSvg) {
    const text = await blob.text();
    const size = parseSvgSize(text) || { width: 1080, height: 1080 };
    const objectUrl = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const png = await rasterizeToPng(objectUrl, size.width, size.height, scale);
      triggerDownload(png, outName);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const width = img.naturalWidth || 1080;
    const height = img.naturalHeight || 1080;
    const png = await rasterizeToPng(objectUrl, width, height, scale);
    triggerDownload(png, outName);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
