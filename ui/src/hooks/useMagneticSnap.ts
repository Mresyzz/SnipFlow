/**
 * Binary search to snap to nearest keyframe within a threshold
 */
export function snapToKeyframe(
  time: number,
  keyframes: number[],
  thresholdSec = 0.2
): number {
  if (keyframes.length === 0) return time;

  let left = 0;
  let right = keyframes.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (Math.abs(keyframes[mid] - time) < 1e-4) return keyframes[mid];
    if (keyframes[mid] < time) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  const candidates: number[] = [];
  if (right >= 0) candidates.push(keyframes[right]);
  if (left < keyframes.length) candidates.push(keyframes[left]);

  let closest = time;
  let minDiff = Infinity;

  for (const kf of candidates) {
    const diff = Math.abs(kf - time);
    if (diff < minDiff) {
      minDiff = diff;
      closest = kf;
    }
  }

  return minDiff <= thresholdSec ? closest : time;
}
