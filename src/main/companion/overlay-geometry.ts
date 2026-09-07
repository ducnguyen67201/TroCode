import type { Point, Rectangle } from 'electron';

export function boundsEqual(left: Rectangle, right: Rectangle): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

export function pointEqual(left: Point | null, right: Point): boolean {
  return left?.x === right.x && left.y === right.y;
}
