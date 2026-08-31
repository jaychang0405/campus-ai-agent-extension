// Shared helpers for converting the pipeline's generic `image` input
// ({ path? , buffer?, dataUrl?, width, height }) into whatever shape a
// given provider's HTTP API expects.

export async function toBuffer(image) {
  if (image.buffer) return image.buffer;
  if (image.dataUrl) return Buffer.from(image.dataUrl.split(',')[1], 'base64');
  if (image.path) {
    const { readFile } = await import('node:fs/promises');
    return readFile(image.path);
  }
  throw new Error('image must provide one of: buffer, dataUrl, path');
}

export async function toDataUrl(image) {
  if (image.dataUrl) return image.dataUrl;
  const buffer = await toBuffer(image);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
