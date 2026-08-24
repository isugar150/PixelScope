import type { Point, Size } from '../coordinate';
import type { RgbColor } from './color-converter';

export function viewportToImagePixel(point: Point, viewport: Size, image: Size): Point {
  const scaleX = image.width / Math.max(1, viewport.width);
  const scaleY = image.height / Math.max(1, viewport.height);
  return {
    x: Math.min(image.width - 1, Math.max(0, Math.floor(point.x * scaleX))),
    y: Math.min(image.height - 1, Math.max(0, Math.floor(point.y * scaleY))),
  };
}

export class PixelSampler {
  readonly #canvas = document.createElement('canvas');
  readonly #context: CanvasRenderingContext2D;

  public constructor() {
    const context = this.#canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('Canvas 픽셀 컨텍스트를 만들 수 없습니다.');
    this.#context = context;
  }

  public get size(): Size { return { width: this.#canvas.width, height: this.#canvas.height }; }

  public async load(dataUrl: string): Promise<void> {
    const image = await loadImage(dataUrl);
    this.#canvas.width = image.naturalWidth;
    this.#canvas.height = image.naturalHeight;
    this.#context.drawImage(image, 0, 0);
  }

  public sample(viewportPoint: Point, viewport: Size): RgbColor | null {
    if (this.#canvas.width === 0 || this.#canvas.height === 0) return null;
    const pixel = viewportToImagePixel(viewportPoint, viewport, this.size);
    const data = this.#context.getImageData(pixel.x, pixel.y, 1, 1).data;
    const r = data[0], g = data[1], b = data[2], alpha = data[3];
    if (r === undefined || g === undefined || b === undefined || alpha === undefined) return null;
    return { r, g, b, a: alpha / 255 };
  }

  public drawZoom(target: CanvasRenderingContext2D, point: Point, viewport: Size, size = 9): void {
    const pixel = viewportToImagePixel(point, viewport, this.size);
    const source = calculateSampleRegion(pixel, this.size, size);
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, target.canvas.width, target.canvas.height);
    target.drawImage(this.#canvas, source.x, source.y, source.size, source.size, 0, 0, target.canvas.width, target.canvas.height);
  }
}

export function calculateSampleRegion(pixel: Point, image: Size, requestedSize: number): { x: number; y: number; size: number } {
  const size = Math.max(1, Math.min(requestedSize, image.width, image.height));
  const half = Math.floor(size / 2);
  return {
    x: Math.max(0, Math.min(image.width - size, pixel.x - half)),
    y: Math.max(0, Math.min(image.height - size, pixel.y - half)),
    size,
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('화면 캡처 이미지를 읽을 수 없습니다.')), { once: true });
    image.src = source;
  });
}
