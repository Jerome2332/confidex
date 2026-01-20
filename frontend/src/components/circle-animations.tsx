'use client';

import { useEffect, useRef } from 'react';

const CANVAS_WIDTH = 180;
const CANVAS_HEIGHT = 180;
const GLOBAL_SPEED = 0.5;

const MONOCHROME_FILL = (opacity: number) =>
  `rgba(255, 255, 255, ${Math.max(0, Math.min(1, opacity))})`;
const MONOCHROME_STROKE = (opacity: number) =>
  `rgba(255, 255, 255, ${Math.max(0, Math.min(1, opacity))})`;

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type AnimationType =
  | 'sphere-scan'
  | 'crystalline-refraction'
  | 'sonar-sweep'
  | 'helix-scanner'
  | 'interconnecting-waves'
  | 'cylindrical-analysis'
  | 'voxel-matrix-morph'
  | 'phased-array-emitter'
  | 'crystalline-cube-refraction';

interface CircleAnimationProps {
  type: AnimationType;
  title: string;
  className?: string;
}

function CornerDecoration({ position }: { position: string }) {
  const rotations: Record<string, string> = {
    'top-left': '',
    'top-right': 'rotate(90deg)',
    'bottom-left': 'rotate(-90deg)',
    'bottom-right': 'rotate(180deg)',
  };

  const positions: Record<string, string> = {
    'top-left': 'top-[-8px] left-[-8px]',
    'top-right': 'top-[-8px] right-[-8px]',
    'bottom-left': 'bottom-[-8px] left-[-8px]',
    'bottom-right': 'bottom-[-8px] right-[-8px]',
  };

  const delays: Record<string, string> = {
    'top-left': 'delay-0',
    'top-right': 'delay-100',
    'bottom-left': 'delay-200',
    'bottom-right': 'delay-300',
  };

  return (
    <div
      className={`absolute w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity ${delays[position]} ${positions[position]} z-10 pointer-events-none`}
      style={{ transform: rotations[position] }}
    >
      <svg width="16" height="16" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <polygon
          points="448,224 288,224 288,64 224,64 224,224 64,224 64,288 224,288 224,448 288,448 288,288 448,288"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}

export function CircleAnimation({ type, title, className = '' }: CircleAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const timeRef = useRef({ time: 0, lastTime: 0 });
  const animateFnRef = useRef<((timestamp: number) => void) | null>(null);

  // Create animation function once on mount/type change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.warn('[CircleAnimation] No canvas ref');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[CircleAnimation] No canvas context');
      return;
    }

    // Reset time state when type changes
    timeRef.current = { time: 0, lastTime: 0 };

    const getTime = () => timeRef.current.time;
    const setTime = (t: number) => { timeRef.current.time = t; };
    const getLastTime = () => timeRef.current.lastTime;
    const setLastTime = (t: number) => { timeRef.current.lastTime = t; };

    // Create the animation function for this type
    switch (type) {
      case 'sphere-scan':
        animateFnRef.current = createSphereScan(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      case 'crystalline-refraction':
        animateFnRef.current = createCrystallineRefraction(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      case 'sonar-sweep':
        animateFnRef.current = createSonarSweep(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      case 'helix-scanner':
        animateFnRef.current = createHelixScanner(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      case 'interconnecting-waves':
        animateFnRef.current = createInterconnectingWaves(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      case 'cylindrical-analysis':
        animateFnRef.current = createCylindricalAnalysis(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      case 'voxel-matrix-morph':
        animateFnRef.current = createVoxelMatrixMorph(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      case 'phased-array-emitter':
        animateFnRef.current = createPhasedArrayEmitter(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      case 'crystalline-cube-refraction':
        animateFnRef.current = createCrystallineCubeRefraction(ctx, getTime, setTime, getLastTime, setLastTime);
        break;
      default:
        console.warn('[CircleAnimation] Unknown animation type:', type);
        return;
    }

    let isRunning = true;

    function loop(timestamp: number) {
      if (!isRunning || !animateFnRef.current) return;
      try {
        animateFnRef.current(timestamp);
      } catch (err) {
        console.error('[CircleAnimation] Animation error:', err);
        isRunning = false;
        return;
      }
      animationRef.current = requestAnimationFrame(loop);
    }

    // Start the animation loop
    animationRef.current = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      animateFnRef.current = null;
    };
  }, [type]);

  const showTitle = title && title.trim().length > 0;

  return (
    <div
      className={`group relative w-[220px] ${showTitle ? 'h-[220px]' : 'h-[200px]'} border border-white/10 bg-black/50 p-2.5 flex flex-col items-center overflow-visible transition-colors hover:border-white/30 ${className}`}
    >
      <CornerDecoration position="top-left" />
      <CornerDecoration position="top-right" />
      <CornerDecoration position="bottom-left" />
      <CornerDecoration position="bottom-right" />
      {showTitle && (
        <div className="mb-2.5 text-xs tracking-wider uppercase text-center text-white/90">
          {title}
        </div>
      )}
      <div className="relative w-[180px] h-[180px] flex justify-center items-center">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="absolute left-0 top-0"
        />
      </div>
    </div>
  );
}

// Animation creators
function createSphereScan(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const radius = CANVAS_WIDTH * 0.4;
  const numDots = 250;
  const dots: { x: number; y: number; z: number }[] = [];

  for (let i = 0; i < numDots; i++) {
    const theta = Math.acos(1 - 2 * (i / numDots));
    const phi = Math.sqrt(numDots * Math.PI) * theta;
    dots.push({
      x: radius * Math.sin(theta) * Math.cos(phi),
      y: radius * Math.sin(theta) * Math.sin(phi),
      z: radius * Math.cos(theta),
    });
  }

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    const deltaTime = timestamp - (lastTime || timestamp);
    setLastTime(timestamp);
    setTime(getTime() + deltaTime * 0.0005 * GLOBAL_SPEED);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const rotX = Math.sin(time * 0.3) * 0.5;
    const rotY = time * 0.5;
    const easedTime = easeInOutCubic((Math.sin(time * 2.5) + 1) / 2);
    const scanLine = (easedTime * 2 - 1) * radius;
    const scanWidth = 25;

    dots.forEach((dot) => {
      let { x, y, z } = dot;
      let nX = x * Math.cos(rotY) - z * Math.sin(rotY);
      let nZ = x * Math.sin(rotY) + z * Math.cos(rotY);
      x = nX;
      z = nZ;
      let nY = y * Math.cos(rotX) - z * Math.sin(rotX);
      nZ = y * Math.sin(rotX) + z * Math.cos(rotX);
      y = nY;
      z = nZ;
      const scale = (z + radius * 1.5) / (radius * 2.5);
      const pX = centerX + x;
      const pY = centerY + y;
      const distToScan = Math.abs(y - scanLine);
      const scanInfluence =
        distToScan < scanWidth ? Math.cos((distToScan / scanWidth) * (Math.PI / 2)) : 0;
      const size = Math.max(0, scale * 2.0 + scanInfluence * 2.5);
      const opacity = Math.max(0, scale * 0.6 + scanInfluence * 0.4);
      ctx.beginPath();
      ctx.arc(pX, pY, size, 0, Math.PI * 2);
      ctx.fillStyle = MONOCHROME_FILL(opacity);
      ctx.fill();
    });
  };
}

function createCrystallineRefraction(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const gridSize = 15;
  const spacing = CANVAS_WIDTH / (gridSize - 1);
  const dots: { x: number; y: number }[] = [];

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      dots.push({ x: c * spacing, y: r * spacing });
    }
  }

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    const deltaTime = timestamp - (lastTime || timestamp);
    setLastTime(timestamp);
    setTime(getTime() + deltaTime * 0.16 * GLOBAL_SPEED);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const waveRadius = time % (CANVAS_WIDTH * 1.2);
    const waveWidth = 60;

    dots.forEach((dot) => {
      const dist = Math.hypot(dot.x - centerX, dot.y - centerY);
      const distToWave = Math.abs(dist - waveRadius);
      let displacement = 0;
      if (distToWave < waveWidth / 2) {
        const wavePhase = (distToWave / (waveWidth / 2)) * Math.PI;
        displacement = easeInOutCubic(Math.sin(wavePhase)) * 10;
      }
      const angleToCenter = Math.atan2(dot.y - centerY, dot.x - centerX);
      const dx = Math.cos(angleToCenter) * displacement;
      const dy = Math.sin(angleToCenter) * displacement;
      const opacity = 0.2 + (Math.abs(displacement) / 10) * 0.8;
      const size = 1.2 + (Math.abs(displacement) / 10) * 2;
      ctx.beginPath();
      ctx.arc(dot.x + dx, dot.y + dy, size, 0, Math.PI * 2);
      ctx.fillStyle = MONOCHROME_FILL(opacity);
      ctx.fill();
    });
  };
}

function createSonarSweep(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const fadeTime = 2500;
  const rings: { r: number; angle: number; lastSeen: number }[] = [];

  for (let r = 20; r <= 80; r += 15) {
    for (let i = 0; i < r / 2; i++) {
      rings.push({
        r,
        angle: (i / (r / 2)) * Math.PI * 2,
        lastSeen: -fadeTime,
      });
    }
  }

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    setLastTime(timestamp);
    setTime(timestamp);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const scanAngle = (time * 0.001 * (Math.PI / 2) * GLOBAL_SPEED) % (Math.PI * 2);

    rings.forEach((dot) => {
      let angleDiff = Math.abs(dot.angle - scanAngle);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff < 0.05) dot.lastSeen = time;
      const timeSinceSeen = time - dot.lastSeen;
      if (timeSinceSeen < fadeTime) {
        const t = timeSinceSeen / fadeTime;
        const opacity = 1 - easeInOutCubic(t);
        const size = 1 + opacity * 1.5;
        const x = centerX + dot.r * Math.cos(dot.angle);
        const y = centerY + dot.r * Math.sin(dot.angle);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = MONOCHROME_FILL(opacity);
        ctx.fill();
      }
    });
  };
}

function createHelixScanner(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const numDots = 100;
  const radius = 35;
  const height = 120;
  const dots: { angle: number; y: number }[] = [];

  for (let i = 0; i < numDots; i++) {
    dots.push({ angle: i * 0.3, y: (i / numDots) * height - height / 2 });
  }

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    const deltaTime = timestamp - (lastTime || timestamp);
    setLastTime(timestamp);
    setTime(getTime() + deltaTime * 0.001 * GLOBAL_SPEED);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const loopDuration = 8;
    const seamlessProgress = Math.sin((time / loopDuration) * Math.PI * 2);
    const scanY = seamlessProgress * (height / 2);
    const scanWidth = 25;
    const trailLength = height * 0.3;

    dots.forEach((dot) => {
      const rotation = time;
      const x = radius * Math.cos(dot.angle + rotation);
      const z = radius * Math.sin(dot.angle + rotation);
      const pX = centerX + x;
      const pY = centerY + dot.y;
      const scale = (z + radius) / (radius * 2);
      const distToScan = Math.abs(dot.y - scanY);
      const leadingEdgeInfluence =
        distToScan < scanWidth ? Math.cos((distToScan / scanWidth) * (Math.PI / 2)) : 0;
      let trailInfluence = 0;
      const distBehindScan = dot.y - scanY;
      const isMovingUp = Math.cos((time / loopDuration) * Math.PI * 2) > 0;
      if (isMovingUp && distBehindScan < 0 && Math.abs(distBehindScan) < trailLength) {
        trailInfluence = Math.pow(1 - Math.abs(distBehindScan) / trailLength, 2) * 0.4;
      } else if (!isMovingUp && distBehindScan > 0 && Math.abs(distBehindScan) < trailLength) {
        trailInfluence = Math.pow(1 - Math.abs(distBehindScan) / trailLength, 2) * 0.4;
      }
      const totalInfluence = Math.max(leadingEdgeInfluence, trailInfluence);
      const size = Math.max(0, scale * 1.8 + totalInfluence * 2.8);
      const opacity = Math.max(0, scale * 0.4 + totalInfluence * 0.6);
      ctx.beginPath();
      ctx.arc(pX, pY, size, 0, Math.PI * 2);
      ctx.fillStyle = MONOCHROME_FILL(opacity);
      ctx.fill();
    });
  };
}

function createInterconnectingWaves(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const dotRings = [
    { radius: 20, count: 12 },
    { radius: 45, count: 24 },
    { radius: 70, count: 36 },
  ];

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    const deltaTime = timestamp - (lastTime || timestamp);
    setLastTime(timestamp);
    setTime(getTime() + deltaTime * 0.001 * GLOBAL_SPEED);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    dotRings.forEach((ring, ringIndex) => {
      if (ringIndex >= dotRings.length - 1) return;
      const nextRing = dotRings[ringIndex + 1];
      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2;
        const radiusPulse1 = Math.sin(time * 2 - ringIndex * 0.4) * 3;
        const x1 = centerX + Math.cos(angle) * (ring.radius + radiusPulse1);
        const y1 = centerY + Math.sin(angle) * (ring.radius + radiusPulse1);
        const nextRingRatio = nextRing.count / ring.count;
        for (let j = 0; j < nextRingRatio; j++) {
          const nextAngle = ((i * nextRingRatio + j) / nextRing.count) * Math.PI * 2;
          const radiusPulse2 = Math.sin(time * 2 - (ringIndex + 1) * 0.4) * 3;
          const x2 = centerX + Math.cos(nextAngle) * (nextRing.radius + radiusPulse2);
          const y2 = centerY + Math.sin(nextAngle) * (nextRing.radius + radiusPulse2);
          const lineOpacity =
            0.1 + ((Math.sin(time * 3 - ringIndex * 0.5 + i * 0.3) + 1) / 2) * 0.4;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineWidth = 0.75;
          ctx.strokeStyle = MONOCHROME_STROKE(lineOpacity);
          ctx.stroke();
        }
      }
    });

    dotRings.forEach((ring, ringIndex) => {
      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2;
        const radiusPulse = Math.sin(time * 2 - ringIndex * 0.4) * 3;
        const x = centerX + Math.cos(angle) * (ring.radius + radiusPulse);
        const y = centerY + Math.sin(angle) * (ring.radius + radiusPulse);
        const dotOpacity = 0.4 + Math.sin(time * 2 - ringIndex * 0.4 + i * 0.2) * 0.6;
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = MONOCHROME_FILL(dotOpacity);
        ctx.fill();
      }
    });
  };
}

function createCylindricalAnalysis(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const radius = 60;
  const height = 100;
  const numLayers = 15;
  const dotsPerLayer = 25;

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    const deltaTime = timestamp - (lastTime || timestamp);
    setLastTime(timestamp);
    setTime(getTime() + deltaTime * 0.001 * GLOBAL_SPEED);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const easedTime = easeInOutCubic((Math.sin(time * 2) + 1) / 2);
    const scanY = centerY + (easedTime * 2 - 1) * (height / 2);
    const scanWidth = 15;

    for (let i = 0; i < numLayers; i++) {
      const layerY = centerY + (i / (numLayers - 1) - 0.5) * height;
      const rot = time * (0.2 + (i % 2) * 0.1);
      for (let j = 0; j < dotsPerLayer; j++) {
        const angle = (j / dotsPerLayer) * Math.PI * 2 + rot;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const scale = (z + radius) / (radius * 2);
        const pX = centerX + x * scale;
        const pY = layerY;
        const distToScan = Math.abs(pY - scanY);
        const scanInfluence =
          distToScan < scanWidth ? Math.cos((distToScan / scanWidth) * (Math.PI / 2)) : 0;
        const size = Math.max(0, scale * 1.5 + scanInfluence * 2);
        const opacity = Math.max(0, scale * 0.5 + scanInfluence * 0.5);
        ctx.beginPath();
        ctx.arc(pX, pY, size, 0, Math.PI * 2);
        ctx.fillStyle = MONOCHROME_FILL(opacity);
        ctx.fill();
      }
    }
  };
}

function createVoxelMatrixMorph(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const points: { x: number; y: number; z: number }[] = [];
  const gridSize = 5;
  const spacing = 20;
  const totalSize = (gridSize - 1) * spacing;

  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      for (let z = 0; z < gridSize; z++) {
        points.push({
          x: (x - (gridSize - 1) / 2) * spacing,
          y: (y - (gridSize - 1) / 2) * spacing,
          z: (z - (gridSize - 1) / 2) * spacing,
        });
      }
    }
  }

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    const deltaTime = timestamp - (lastTime || timestamp);
    setLastTime(timestamp);
    setTime(getTime() + deltaTime * 0.0005 * GLOBAL_SPEED);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const rotX = time * 0.4;
    const rotY = time * 0.6;
    const easedTime = easeInOutCubic((Math.sin(time * 2) + 1) / 2);
    const scanLine = (easedTime * 2 - 1) * (totalSize / 2 + 10);
    const scanWidth = 30;

    points.forEach((p) => {
      let { x, y, z } = p;
      let nX = x * Math.cos(rotY) - z * Math.sin(rotY);
      let nZ = x * Math.sin(rotY) + z * Math.cos(rotY);
      x = nX;
      z = nZ;
      let nY = y * Math.cos(rotX) - z * Math.sin(rotX);
      nZ = y * Math.sin(rotX) + z * Math.cos(rotX);
      y = nY;
      z = nZ;
      const distToScan = Math.abs(y - scanLine);
      let scanInfluence = 0;
      let displacement = 1;
      if (distToScan < scanWidth) {
        scanInfluence = Math.cos((distToScan / scanWidth) * (Math.PI / 2));
        displacement = 1 + scanInfluence * 0.4;
      }
      const scale = (z + 80) / 160;
      const pX = centerX + x * displacement;
      const pY = centerY + y * displacement;
      const size = Math.max(0, scale * 2 + scanInfluence * 2);
      const opacity = Math.max(0.1, scale * 0.7 + scanInfluence * 0.3);
      ctx.beginPath();
      ctx.arc(pX, pY, size, 0, Math.PI * 2);
      ctx.fillStyle = MONOCHROME_FILL(opacity);
      ctx.fill();
    });
  };
}

function createPhasedArrayEmitter(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const fov = 300;
  const points: { x: number; y: number; z: number }[] = [];
  const ringRadii = [20, 40, 60, 80];
  const pointsPerRing = [12, 18, 24, 30];
  const maxRadius = ringRadii[ringRadii.length - 1];

  ringRadii.forEach((radius, i) => {
    for (let j = 0; j < pointsPerRing[i]; j++) {
      const angle = (j / pointsPerRing[i]) * Math.PI * 2;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: 0,
      });
    }
  });

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    const deltaTime = timestamp - (lastTime || timestamp);
    setLastTime(timestamp);
    setTime(getTime() + deltaTime * 0.001 * GLOBAL_SPEED);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const rotX = 1.0;
    const rotY = time * 0.2;
    const waveRadius = (time * 120) % (maxRadius * 1.8);
    const waveWidth = 50;
    const waveHeight = 18;
    const pointsToDraw: { x: number; y: number; z: number; size: number; opacity: number }[] = [];

    points.forEach((p_orig) => {
      let { x, y, z } = { ...p_orig };
      const distFromCenter = Math.hypot(x, y);
      const distToWave = Math.abs(distFromCenter - waveRadius);
      let waveInfluence = 0;
      if (distToWave < waveWidth / 2) {
        const wavePhase = (1 - distToWave / (waveWidth / 2)) * Math.PI;
        z = easeInOutCubic(Math.sin(wavePhase)) * waveHeight;
        waveInfluence = z / waveHeight;
      }
      const cY = Math.cos(rotY);
      const sY = Math.sin(rotY);
      let tX = x * cY - z * sY;
      let tZ = x * sY + z * cY;
      x = tX;
      z = tZ;
      const cX = Math.cos(rotX);
      const sX = Math.sin(rotX);
      const tY = y * cX - z * sX;
      tZ = y * sX + z * cX;
      y = tY;
      z = tZ;
      const scale = fov / (fov + z + 100);
      const pX = centerX + x * scale;
      const pY = centerY + y * scale;
      const size = (1.5 + waveInfluence * 2.5) * scale;
      const opacity = 0.4 + waveInfluence * 0.6;
      pointsToDraw.push({ x: pX, y: pY, z, size, opacity });
    });

    pointsToDraw
      .sort((a, b) => a.z - b.z)
      .forEach((p) => {
        if (p.size < 0.1) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = MONOCHROME_FILL(p.opacity);
        ctx.fill();
      });
  };
}

function createCrystallineCubeRefraction(
  ctx: CanvasRenderingContext2D,
  getTime: () => number,
  setTime: (t: number) => void,
  getLastTime: () => number,
  setLastTime: (t: number) => void
) {
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const fov = 250;
  const points: { x: number; y: number; z: number }[] = [];
  const gridSize = 7;
  const spacing = 15;
  const cubeHalfSize = ((gridSize - 1) * spacing) / 2;
  const maxDist = Math.hypot(cubeHalfSize, cubeHalfSize, cubeHalfSize);

  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      for (let z = 0; z < gridSize; z++) {
        points.push({
          x: x * spacing - cubeHalfSize,
          y: y * spacing - cubeHalfSize,
          z: z * spacing - cubeHalfSize,
        });
      }
    }
  }

  return (timestamp: number) => {
    const lastTime = getLastTime();
    if (!lastTime) setLastTime(timestamp);
    const deltaTime = timestamp - (lastTime || timestamp);
    setLastTime(timestamp);
    setTime(getTime() + deltaTime * 0.0003 * GLOBAL_SPEED);
    const time = getTime();

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const rotX = time * 2;
    const rotY = time * 3;
    const waveRadius = (timestamp * 0.04 * GLOBAL_SPEED) % (maxDist * 1.5);
    const waveWidth = 40;
    const displacementMagnitude = 10;
    const pointsToDraw: { x: number; y: number; z: number; size: number; opacity: number }[] = [];

    points.forEach((p_orig) => {
      let { x, y, z } = { ...p_orig };
      const distFromCenter = Math.hypot(x, y, z);
      const distToWave = Math.abs(distFromCenter - waveRadius);
      let displacementAmount = 0;
      if (distToWave < waveWidth / 2) {
        const wavePhase = (distToWave / (waveWidth / 2)) * (Math.PI / 2);
        displacementAmount = easeInOutCubic(Math.cos(wavePhase)) * displacementMagnitude;
      }
      if (displacementAmount > 0 && distFromCenter > 0) {
        const ratio = (distFromCenter + displacementAmount) / distFromCenter;
        x *= ratio;
        y *= ratio;
        z *= ratio;
      }
      const cY = Math.cos(rotY);
      const sY = Math.sin(rotY);
      let tX = x * cY - z * sY;
      let tZ = x * sY + z * cY;
      x = tX;
      z = tZ;
      const cX = Math.cos(rotX);
      const sX = Math.sin(rotX);
      const tY = y * cX - z * sX;
      tZ = y * sX + z * cX;
      y = tY;
      z = tZ;
      const scale = fov / (fov + z);
      const pX = centerX + x * scale;
      const pY = centerY + y * scale;
      const waveInfluence = displacementAmount / displacementMagnitude;
      const size = (1.5 + waveInfluence * 2.5) * scale;
      const opacity = Math.max(0.1, scale * 0.7 + waveInfluence * 0.4);
      if (size > 0.1) pointsToDraw.push({ x: pX, y: pY, z, size, opacity });
    });

    pointsToDraw
      .sort((a, b) => a.z - b.z)
      .forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = MONOCHROME_FILL(p.opacity);
        ctx.fill();
      });
  };
}

/**
 * TechCardAnimation - Compact animation for tech stack cards
 * Uses a smaller canvas size optimized for card layouts
 */
export function TechCardAnimation({
  type,
  className = ''
}: {
  type: AnimationType;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = 0;
    let time = 0;

    const animations: Record<AnimationType, (timestamp: number) => void> = {
      'sphere-scan': createSphereScan(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
      'crystalline-refraction': createCrystallineRefraction(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
      'sonar-sweep': createSonarSweep(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
      'helix-scanner': createHelixScanner(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
      'interconnecting-waves': createInterconnectingWaves(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
      'cylindrical-analysis': createCylindricalAnalysis(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
      'voxel-matrix-morph': createVoxelMatrixMorph(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
      'phased-array-emitter': createPhasedArrayEmitter(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
      'crystalline-cube-refraction': createCrystallineCubeRefraction(ctx, () => time, (t) => { time = t; }, () => lastTime, (t) => { lastTime = t; }),
    };

    const animate = animations[type];

    function loop(timestamp: number) {
      animate(timestamp);
      animationRef.current = requestAnimationFrame(loop);
    }

    animationRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [type]);

  return (
    <div className={`relative w-[100px] h-[100px] ${className}`}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="absolute inset-0 w-full h-full"
        style={{ transform: 'scale(0.556)', transformOrigin: 'top left' }}
      />
    </div>
  );
}

/**
 * CircleAnimationsGrid - displays all animations in a responsive grid
 */
export function CircleAnimationsGrid() {
  const animations: { type: AnimationType; title: string }[] = [
    { type: 'sphere-scan', title: '3D Sphere Scan' },
    { type: 'crystalline-refraction', title: 'Crystalline Refraction' },
    { type: 'sonar-sweep', title: 'Sonar Sweep' },
    { type: 'helix-scanner', title: 'Helix Scanner' },
    { type: 'interconnecting-waves', title: 'Interconnecting Waves' },
    { type: 'cylindrical-analysis', title: 'Cylindrical Analysis' },
    { type: 'voxel-matrix-morph', title: 'Voxel Matrix Morph' },
    { type: 'phased-array-emitter', title: 'Phased Array Emitter' },
    { type: 'crystalline-cube-refraction', title: 'Crystalline Cube Refraction' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 justify-items-center">
      {animations.map((anim) => (
        <CircleAnimation key={anim.type} type={anim.type} title={anim.title} />
      ))}
    </div>
  );
}
