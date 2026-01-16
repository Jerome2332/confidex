'use client';

import { useEffect, useRef } from 'react';

const DEFAULT_COLORS = [
  "#407CEE",
  "#386BE8",
  "#315DC9",
  "#354EB0",
  "#39419C",
  "#292F70",
  "#242A62"
];

interface GridCell {
  xPos: number;
  yPos: number;
  width: number;
  height: number;
  speed: number;
  opacity: number;
  fadeDirection: 'in' | 'out';
  background: string;
}

interface GriddyAnimationProps {
  width?: number;
  height?: number;
  cellSize?: number;
  colors?: readonly string[];
  className?: string;
  showPalette?: boolean;
}

/**
 * Creates a grid array with cell data for animation
 */
function makeGrid(
  canvasWidth: number,
  canvasHeight: number,
  cellWidth: number,
  cellHeight: number,
  palette: readonly string[]
): GridCell[][] {
  const cellsX = Math.ceil(canvasWidth / cellWidth);
  const cellsY = Math.ceil(canvasHeight / cellHeight);
  const fadeDirections: ('in' | 'out')[] = ['in', 'out'];

  const grid: GridCell[][] = [];

  for (let i = 0; i < cellsY; i++) {
    grid.push([]);

    for (let j = 0; j < cellsX; j++) {
      const cell: GridCell = {
        xPos: j * cellWidth,
        yPos: i * cellHeight,
        width: cellWidth,
        height: cellHeight,
        speed: Math.random() * 0.02,
        opacity: Math.random(),
        fadeDirection: fadeDirections[Math.floor(Math.random() * fadeDirections.length)],
        background: palette[Math.floor(Math.random() * palette.length)]
      };

      grid[i].push(cell);
    }
  }

  return grid;
}

/**
 * Adds a radial lighting effect to the center of the canvas
 */
function addLighting(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const radialGradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  radialGradient.addColorStop(0.0, '#2A3178');
  radialGradient.addColorStop(1, '#000000');

  ctx.fillStyle = radialGradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

/**
 * GriddyAnimation - Canvas-based grid animation with fading cells and lighting
 */
export function GriddyAnimation({
  width = 340,
  height = 340,
  cellSize = 12,
  colors = DEFAULT_COLORS,
  className = '',
  showPalette = false
}: GriddyAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<GridCell[][] | null>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize grid
    gridRef.current = makeGrid(width, height, cellSize, cellSize, colors);

    const renderGrid = () => {
      const grid = gridRef.current;
      if (!grid) return;

      // Reset canvas
      ctx.fillStyle = '#292F70';
      ctx.fillRect(0, 0, width, height);

      // Setup cell styles
      ctx.strokeStyle = '#0E151F';
      ctx.lineWidth = 0.5;

      grid.forEach((row) => {
        row.forEach((cell) => {
          ctx.fillStyle = cell.background;

          // Update opacity based on fade direction
          if (cell.fadeDirection === 'in') {
            if (cell.opacity + cell.speed <= 1) {
              cell.opacity = cell.opacity + cell.speed;
            } else {
              cell.opacity = cell.opacity - cell.speed;
              cell.fadeDirection = 'out';
            }
          } else {
            if (cell.opacity - cell.speed >= 0) {
              cell.opacity = cell.opacity - cell.speed;
            } else {
              cell.opacity = cell.opacity + cell.speed;
              cell.fadeDirection = 'in';
            }
          }

          ctx.globalAlpha = cell.opacity;
          ctx.fillRect(cell.xPos, cell.yPos, cell.width, cell.height);
          ctx.strokeRect(cell.xPos, cell.yPos, cell.width, cell.height);
          ctx.globalAlpha = 1;
        });
      });

      // Add center lighting effect
      addLighting(ctx, width / 2, height / 2, Math.min(width, height) * 0.6);

      animationRef.current = requestAnimationFrame(renderGrid);
    };

    animationRef.current = requestAnimationFrame(renderGrid);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [width, height, cellSize, colors]);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded-xl border-2 border-[#39419c]"
        style={{
          boxShadow: '0 70px 63px -60px rgba(0,0,0,0.5)'
        }}
      />
      {showPalette && (
        <div className="bg-white/15 border border-white/5 p-2 rounded-lg">
          <div className="flex rounded overflow-hidden">
            {colors.map((color, i) => (
              <div
                key={i}
                className="h-5 flex-1"
                style={{ background: color }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * GriddyAnimationCompact - Smaller version for card layouts
 */
export function GriddyAnimationCompact({
  className = ''
}: {
  className?: string;
}) {
  return (
    <GriddyAnimation
      width={180}
      height={180}
      cellSize={8}
      className={className}
    />
  );
}

/**
 * Color palette presets
 */
export const GRIDDY_PALETTES = {
  blue: DEFAULT_COLORS,
  purple: [
    "#9B59B6",
    "#8E44AD",
    "#7D3C98",
    "#6C3483",
    "#5B2C6F",
    "#4A235A",
    "#3A1C47"
  ],
  green: [
    "#27AE60",
    "#229954",
    "#1E8449",
    "#196F3D",
    "#145A32",
    "#0E6251",
    "#0B5345"
  ],
  orange: [
    "#F39C12",
    "#E67E22",
    "#D35400",
    "#CA6F1E",
    "#BA4A00",
    "#A04000",
    "#873600"
  ],
  monochrome: [
    "#FFFFFF",
    "#E0E0E0",
    "#C0C0C0",
    "#A0A0A0",
    "#808080",
    "#606060",
    "#404040"
  ]
} as const;

export type GriddyPalette = keyof typeof GRIDDY_PALETTES;
