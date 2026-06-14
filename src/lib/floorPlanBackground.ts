export interface FloorPlanBackgroundRectOptions {
  canvasWidth: number;
  canvasHeight: number;
  imageWidth: number;
  imageHeight: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
}

export function getFittedBackgroundRect({
  canvasWidth,
  canvasHeight,
  imageWidth,
  imageHeight,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
}: FloorPlanBackgroundRectOptions) {
  const safeImageWidth = imageWidth > 0 ? imageWidth : canvasWidth;
  const safeImageHeight = imageHeight > 0 ? imageHeight : canvasHeight;
  const safeScale = scale > 0 ? scale : 1;
  const fitScale = Math.min(canvasWidth / safeImageWidth, canvasHeight / safeImageHeight);

  const width = safeImageWidth * fitScale * safeScale;
  const height = safeImageHeight * fitScale * safeScale;
  const baseX = (canvasWidth - width) / 2;
  const baseY = (canvasHeight - height) / 2;

  return {
    x: baseX + offsetX,
    y: baseY + offsetY,
    width,
    height,
    baseX,
    baseY,
  };
}
