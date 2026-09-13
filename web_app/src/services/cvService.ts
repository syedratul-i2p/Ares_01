// cvService.ts
// Local Computer Vision using pure Canvas Pixel Manipulation

export interface CVResult {
  x: number; // 0 to 1 (normalized, 0.5 is center)
  y: number; // 0 to 1
  found: boolean;
  size?: number; // relative size of the blob
}

/**
 * Tracks a specific color in the canvas context
 */
export function trackColor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  targetRGB: [number, number, number],
  tolerance: number = 50
): CVResult {
  if (!ctx || width === 0 || height === 0) return { x: 0, y: 0, found: false };

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const [tR, tG, tB] = targetRGB;

  // Subsampling for performance (check every 4th pixel)
  const step = 4;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Simple euclidean distance or box distance
      if (
        Math.abs(r - tR) < tolerance &&
        Math.abs(g - tG) < tolerance &&
        Math.abs(b - tB) < tolerance
      ) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }

  if (count > 10) { // Minimum threshold to avoid noise
    return {
      x: (sumX / count) / width,
      y: (sumY / count) / height,
      found: true,
      size: count
    };
  }

  return { x: 0, y: 0, found: false };
}

/**
 * Tracks a dark line in the lower section of the frame
 */
export function trackLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): CVResult {
  if (!ctx || width === 0 || height === 0) return { x: 0, y: 0, found: false };

  // Only check the bottom 25% of the screen
  const scanAreaY = Math.floor(height * 0.75);
  const scanAreaHeight = height - scanAreaY;
  
  const imageData = ctx.getImageData(0, scanAreaY, width, scanAreaHeight);
  const data = imageData.data;

  let sumX = 0;
  let count = 0;
  
  // Find darkest pixels
  const step = 4;
  for (let y = 0; y < scanAreaHeight; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      // Calculate grayscale intensity
      const intensity = (data[i] + data[i + 1] + data[i + 2]) / 3;
      
      // If pixel is very dark (threshold)
      if (intensity < 60) {
        sumX += x;
        count++;
      }
    }
  }

  if (count > 20) {
    return {
      x: (sumX / count) / width, // Return normalized center of the line
      y: 0.9, // Lower part of screen
      found: true
    };
  }

  return { x: 0, y: 0, found: false };
}


export function trackFace(ctx: CanvasRenderingContext2D, width: number, height: number): CVResult {
  // Placeholder for Haar Cascade Face Detection
  // Since we are strictly offline and lightweight, we fallback to a center-bias or contrast heuristic for demonstration
  return { x: 0.5, y: 0.5, found: false }; 
}

export function trackOptical(ctx: CanvasRenderingContext2D, width: number, height: number): CVResult {
  // Simple brightness contrast tracker (tracks the brightest spot - e.g. a flashlight or bright object)
  if (!ctx || width === 0 || height === 0) return { x: 0, y: 0, found: false };
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  let maxBrightness = 0;
  let bestX = 0, bestY = 0;
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const i = (y * width + x) * 4;
      const brightness = data[i] + data[i+1] + data[i+2];
      if (brightness > maxBrightness) {
        maxBrightness = brightness;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (maxBrightness > 600) {
    return { x: bestX / width, y: bestY / height, found: true };
  }
  return { x: 0, y: 0, found: false };
}
