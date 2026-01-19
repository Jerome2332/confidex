'use client';

import { useEffect, useRef, FC } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

interface FiberStreamConfig {
  // Colors
  colorBg?: string;
  colorLine?: string;
  colorSignal?: string;
  colorSignal2?: string;
  colorSignal3?: string;
  useColor2?: boolean;
  useColor3?: boolean;

  // Global Transform
  lineCount?: number;
  globalRotation?: number;
  positionX?: number;
  positionY?: number;

  // Geometry
  spreadHeight?: number;
  spreadDepth?: number;
  curveLength?: number;
  straightLength?: number;
  curvePower?: number;

  // Line Animation
  waveSpeed?: number;
  waveHeight?: number;
  lineOpacity?: number;

  // Signals
  signalCount?: number;
  speedGlobal?: number;
  trailLength?: number;

  // Visuals (Bloom)
  bloomStrength?: number;
  bloomRadius?: number;
}

interface FiberStreamAnimationProps {
  className?: string;
  config?: FiberStreamConfig;
  width?: number | string;
  height?: number | string;
}

const SEGMENT_COUNT = 150;

const DEFAULT_CONFIG: Required<FiberStreamConfig> = {
  colorBg: '#080808',
  colorLine: '#373f48',
  colorSignal: '#8fc9ff',
  colorSignal2: '#ff0055',
  colorSignal3: '#ffcc00',
  useColor2: false,
  useColor3: false,
  lineCount: 80,
  globalRotation: 0,
  positionX: 0,
  positionY: 0,
  spreadHeight: 30.33,
  spreadDepth: 0,
  curveLength: 50,
  straightLength: 100,
  curvePower: 0.8265,
  waveSpeed: 2.48,
  waveHeight: 0.145,
  lineOpacity: 0.557,
  signalCount: 94,
  speedGlobal: 0.345,
  trailLength: 3,
  bloomStrength: 3.0,
  bloomRadius: 0.5,
};

export const FiberStreamAnimation: FC<FiberStreamAnimationProps> = ({
  className = '',
  config = {},
  width = '100%',
  height = 400,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width || 800;
    const containerHeight = rect.height || 400;

    // Merge config with defaults
    const params = { ...DEFAULT_CONFIG, ...config };

    // Calculate center position
    params.positionX = (params.curveLength - params.straightLength) / 2;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(params.colorBg);
    scene.fog = new THREE.FogExp2(params.colorBg, 0.002);

    const camera = new THREE.PerspectiveCamera(
      45,
      containerWidth / containerHeight,
      1,
      1000
    );
    camera.position.set(0, 0, 90);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerWidth, containerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Group for rotation and positioning
    const contentGroup = new THREE.Group();
    contentGroup.position.set(params.positionX, params.positionY, 0);
    contentGroup.rotation.z = THREE.MathUtils.degToRad(params.globalRotation);
    scene.add(contentGroup);

    // Post-processing
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(containerWidth, containerHeight),
      1.5,
      0.4,
      0.85
    );
    bloomPass.threshold = 0;
    bloomPass.strength = params.bloomStrength;
    bloomPass.radius = params.bloomRadius;

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composerRef.current = composer;

    // Path calculation
    function getPathPoint(
      t: number,
      lineIndex: number,
      time: number
    ): THREE.Vector3 {
      const totalLen = params.curveLength + params.straightLength;
      const currentX = -params.curveLength + t * totalLen;

      let y = 0;
      const z = 0;
      const spreadFactor = (lineIndex / params.lineCount - 0.5) * 2;

      if (currentX < 0) {
        const ratio = (currentX + params.curveLength) / params.curveLength;
        let shapeFactor = (Math.cos(ratio * Math.PI) + 1) / 2;
        shapeFactor = Math.pow(shapeFactor, params.curvePower);

        y = spreadFactor * params.spreadHeight * shapeFactor;

        const waveFactor = shapeFactor;
        const wave =
          Math.sin(time * params.waveSpeed + currentX * 0.1 + lineIndex) *
          params.waveHeight *
          waveFactor;
        y += wave;
      }

      return new THREE.Vector3(currentX, y, z);
    }

    // Materials
    const bgMaterial = new THREE.LineBasicMaterial({
      color: params.colorLine,
      transparent: true,
      opacity: params.lineOpacity,
      depthWrite: false,
    });

    const signalMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });

    const signalColorObj1 = new THREE.Color(params.colorSignal);
    const signalColorObj2 = new THREE.Color(params.colorSignal2);
    const signalColorObj3 = new THREE.Color(params.colorSignal3);

    function pickSignalColor(): THREE.Color {
      const choices = [signalColorObj1];
      if (params.useColor2) choices.push(signalColorObj2);
      if (params.useColor3) choices.push(signalColorObj3);
      return choices[Math.floor(Math.random() * choices.length)];
    }

    // Create background lines
    const backgroundLines: THREE.Line[] = [];
    for (let i = 0; i < params.lineCount; i++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(SEGMENT_COUNT * 3);
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3)
      );

      const line = new THREE.Line(geometry, bgMaterial);
      line.userData = { id: i };
      line.renderOrder = 0;
      contentGroup.add(line);
      backgroundLines.push(line);
    }

    // Create signals
    interface Signal {
      mesh: THREE.Line;
      laneIndex: number;
      speed: number;
      progress: number;
      history: THREE.Vector3[];
      assignedColor: THREE.Color;
    }

    const signals: Signal[] = [];
    const maxTrail = 150;

    for (let i = 0; i < params.signalCount; i++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(maxTrail * 3);
      const colors = new Float32Array(maxTrail * 3);

      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3)
      );
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mesh = new THREE.Line(geometry, signalMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      contentGroup.add(mesh);

      signals.push({
        mesh,
        laneIndex: Math.floor(Math.random() * params.lineCount),
        speed: 0.2 + Math.random() * 0.5,
        progress: Math.random(),
        history: [],
        assignedColor: pickSignalColor(),
      });
    }

    // Animation loop
    const clock = new THREE.Clock();

    function animate() {
      animationRef.current = requestAnimationFrame(animate);

      const time = clock.getElapsedTime();

      // Update lines
      backgroundLines.forEach((line) => {
        const positions = line.geometry.attributes.position
          .array as Float32Array;
        const lineId = line.userData.id as number;
        for (let j = 0; j < SEGMENT_COUNT; j++) {
          const t = j / (SEGMENT_COUNT - 1);
          const vec = getPathPoint(t, lineId, time);
          positions[j * 3] = vec.x;
          positions[j * 3 + 1] = vec.y;
          positions[j * 3 + 2] = vec.z;
        }
        line.geometry.attributes.position.needsUpdate = true;
      });

      // Update signals
      signals.forEach((sig) => {
        sig.progress += sig.speed * 0.005 * params.speedGlobal;

        if (sig.progress > 1.0) {
          sig.progress = 0;
          sig.laneIndex = Math.floor(Math.random() * params.lineCount);
          sig.history = [];
          sig.assignedColor = pickSignalColor();
        }

        const pos = getPathPoint(sig.progress, sig.laneIndex, time);
        sig.history.push(pos);

        if (sig.history.length > params.trailLength + 1) {
          sig.history.shift();
        }

        const positions = sig.mesh.geometry.attributes.position
          .array as Float32Array;
        const colors = sig.mesh.geometry.attributes.color.array as Float32Array;

        const drawCount = Math.max(1, params.trailLength);
        const currentLen = sig.history.length;

        for (let i = 0; i < drawCount; i++) {
          let index = currentLen - 1 - i;
          if (index < 0) index = 0;

          const p = sig.history[index] || new THREE.Vector3();

          positions[i * 3] = p.x;
          positions[i * 3 + 1] = p.y;
          positions[i * 3 + 2] = p.z;

          let alpha = 1;
          if (params.trailLength > 0) {
            alpha = Math.max(0, 1 - i / params.trailLength);
          }

          colors[i * 3] = sig.assignedColor.r * alpha;
          colors[i * 3 + 1] = sig.assignedColor.g * alpha;
          colors[i * 3 + 2] = sig.assignedColor.b * alpha;
        }

        sig.mesh.geometry.setDrawRange(0, drawCount);
        sig.mesh.geometry.attributes.position.needsUpdate = true;
        sig.mesh.geometry.attributes.color.needsUpdate = true;
      });

      composer.render();
    }

    animate();

    // Resize handler
    const handleResize = () => {
      const newRect = container.getBoundingClientRect();
      const newWidth = newRect.width || 800;
      const newHeight = newRect.height || 400;

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
      composer.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      // Dispose geometries and materials
      backgroundLines.forEach((line) => {
        line.geometry.dispose();
      });
      signals.forEach((sig) => {
        sig.mesh.geometry.dispose();
      });
      bgMaterial.dispose();
      signalMaterial.dispose();

      // Dispose renderer
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [config]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
};

// Preset configurations
export const FIBER_STREAM_PRESETS = {
  default: {},

  monochrome: {
    colorSignal: '#ffffff',
    colorLine: '#2a2a2a',
    useColor2: false,
    useColor3: false,
  },

  privacy: {
    colorSignal: '#10b981', // emerald
    colorLine: '#1a2e1a',
    colorBg: '#050a05',
    useColor2: true,
    colorSignal2: '#34d399',
    bloomStrength: 2.5,
  },

  multicolor: {
    useColor2: true,
    useColor3: true,
    colorSignal: '#8fc9ff',
    colorSignal2: '#ff0055',
    colorSignal3: '#ffcc00',
  },

  dense: {
    lineCount: 150,
    signalCount: 200,
    trailLength: 5,
    speedGlobal: 0.5,
  },

  minimal: {
    lineCount: 40,
    signalCount: 30,
    trailLength: 2,
    bloomStrength: 2.0,
    lineOpacity: 0.3,
  },

  wide: {
    spreadHeight: 50,
    curveLength: 80,
    straightLength: 150,
  },
} as const;

export default FiberStreamAnimation;
