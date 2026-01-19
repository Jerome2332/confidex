'use client';

import { FC, useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  Lock,
  Cpu,
  Database,
  CheckCircle,
  ArrowDown,
  Lightning,
  Eye,
  EyeSlash,
} from '@phosphor-icons/react';

interface FlowNode {
  id: string;
  step: number;
  label: string;
  description: string;
  icon: React.ReactNode;
  status: 'pending' | 'active' | 'complete';
}

interface FlowStage {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  glowColor: string;
  nodes: FlowNode[];
}

const stages: FlowStage[] = [
  {
    id: 'frontend',
    title: 'USER FRONTEND',
    subtitle: 'Client-Side Privacy',
    color: 'white',
    glowColor: 'rgba(255,255,255,0.3)',
    nodes: [
      { id: 'zk', step: 1, label: 'ZK Proof', description: 'Generate eligibility proof', icon: <Shield size={16} />, status: 'pending' },
      { id: 'encrypt', step: 2, label: 'Encrypt', description: 'RescueCipher on values', icon: <Lock size={16} />, status: 'pending' },
      { id: 'submit', step: 3, label: 'Submit', description: 'Place order transaction', icon: <Lightning size={16} />, status: 'pending' },
      { id: 'listen', step: 4, label: 'Listen', description: 'Subscribe to events', icon: <Eye size={16} />, status: 'pending' },
    ],
  },
  {
    id: 'onchain',
    title: 'ON-CHAIN DEX',
    subtitle: 'Solana Program',
    color: 'white',
    glowColor: 'rgba(255,255,255,0.25)',
    nodes: [
      { id: 'verify', step: 5, label: 'Verify ZK', description: 'Sunspot CPI (~200K CU)', icon: <CheckCircle size={16} />, status: 'pending' },
      { id: 'store', step: 6, label: 'Store', description: 'Create order account', icon: <Database size={16} />, status: 'pending' },
      { id: 'match', step: 7, label: 'Match', description: 'Queue MPC comparison', icon: <Cpu size={16} />, status: 'pending' },
      { id: 'callback', step: 8, label: 'Callback', description: 'Receive MPC results', icon: <ArrowDown size={16} />, status: 'pending' },
    ],
  },
  {
    id: 'mpc',
    title: 'ARCIUM MPC',
    subtitle: 'Encrypted Computation',
    color: 'white',
    glowColor: 'rgba(255,255,255,0.2)',
    nodes: [
      { id: 'compare', step: 9, label: 'Compare', description: 'Encrypted price check', icon: <EyeSlash size={16} />, status: 'pending' },
      { id: 'calculate', step: 10, label: 'Calculate', description: 'Encrypted fill amount', icon: <Cpu size={16} />, status: 'pending' },
      { id: 'return', step: 11, label: 'Return', description: 'Only bool/fill revealed', icon: <CheckCircle size={16} />, status: 'pending' },
    ],
  },
  {
    id: 'settlement',
    title: 'SETTLEMENT',
    subtitle: 'Private Transfer',
    color: 'emerald',
    glowColor: 'rgba(16,185,129,0.3)',
    nodes: [
      { id: 'shadowwire', step: 12, label: 'ShadowWire', description: 'Private token transfer', icon: <Lock size={16} />, status: 'pending' },
      { id: 'complete', step: 13, label: 'Complete', description: 'Emit TradeExecuted', icon: <CheckCircle size={16} />, status: 'pending' },
    ],
  },
];

// Animated particle that flows through the diagram
const DataParticle: FC<{ delay: number; duration: number }> = ({ delay, duration }) => {
  return (
    <motion.div
      className="absolute left-1/2 w-1 h-1 rounded-full bg-white"
      style={{
        boxShadow: '0 0 8px 2px rgba(255,255,255,0.6), 0 0 16px 4px rgba(255,255,255,0.3)',
        marginLeft: '-2px',
      }}
      initial={{ top: 0, opacity: 0, scale: 0 }}
      animate={{
        top: ['0%', '100%'],
        opacity: [0, 1, 1, 0],
        scale: [0, 1, 1, 0],
      }}
      transition={{
        duration: duration,
        delay: delay,
        repeat: Infinity,
        ease: 'linear',
      }}
    />
  );
};

// Animated connection line between stages
const ConnectionLine: FC = () => {
  return (
    <div className="relative h-12 flex items-center justify-center">
      {/* Static line */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-white/20 via-white/10 to-white/20" />

      {/* Flowing particles */}
      <div className="absolute left-1/2 top-0 bottom-0">
        <DataParticle delay={0} duration={1.5} />
        <DataParticle delay={0.5} duration={1.5} />
        <DataParticle delay={1} duration={1.5} />
      </div>
    </div>
  );
};

// Individual node component with hover effects
const FlowNodeCard: FC<{
  node: FlowNode;
  stageColor: string;
  index: number;
  totalNodes: number;
  isHovered: boolean;
  onHover: (id: string | null) => void;
}> = ({ node, stageColor, index, totalNodes, isHovered, onHover }) => {
  const isEmerald = stageColor === 'emerald';

  return (
    <motion.div
      className="relative group"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Glow effect on hover */}
      <motion.div
        className={`absolute -inset-1 rounded-xl blur-md transition-opacity duration-300 ${
          isEmerald ? 'bg-emerald-500/20' : 'bg-white/10'
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: isHovered ? 1 : 0 }}
      />

      {/* Card */}
      <motion.div
        className={`relative overflow-hidden rounded-xl border transition-all duration-300 ${
          isEmerald
            ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50'
            : 'bg-white/5 border-white/10 hover:border-white/30'
        }`}
        whileHover={{ scale: 1.02 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        {/* Scan line effect */}
        <motion.div
          className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
          style={{
            background: `linear-gradient(180deg, transparent 0%, ${isEmerald ? 'rgba(16,185,129,0.05)' : 'rgba(255,255,255,0.03)'} 50%, transparent 100%)`,
          }}
          animate={{
            y: ['-100%', '100%'],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'linear',
          }}
        />

        {/* Content */}
        <div className="relative p-4">
          {/* Step number badge */}
          <div className={`absolute -top-0 -right-0 w-6 h-6 rounded-bl-lg rounded-tr-xl flex items-center justify-center text-[10px] font-mono ${
            isEmerald ? 'bg-emerald-500/30 text-emerald-300' : 'bg-white/10 text-white/60'
          }`}>
            {node.step}
          </div>

          {/* Icon */}
          <div className={`mb-3 w-8 h-8 rounded-lg flex items-center justify-center ${
            isEmerald ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white/70'
          }`}>
            {node.icon}
          </div>

          {/* Label */}
          <div className={`font-medium text-sm mb-1 ${
            isEmerald ? 'text-emerald-300' : 'text-white'
          }`}>
            {node.label}
          </div>

          {/* Description */}
          <div className={`text-xs ${
            isEmerald ? 'text-emerald-400/60' : 'text-white/50'
          }`}>
            {node.description}
          </div>
        </div>

        {/* Bottom accent line */}
        <motion.div
          className={`absolute bottom-0 left-0 h-px ${
            isEmerald ? 'bg-emerald-400' : 'bg-white'
          }`}
          initial={{ width: '0%' }}
          whileHover={{ width: '100%' }}
          transition={{ duration: 0.3 }}
        />
      </motion.div>

      {/* Connection to next node (horizontal) */}
      {index < totalNodes - 1 && (
        <div className="hidden md:block absolute top-1/2 -right-3 w-6 h-px overflow-hidden">
          <div className={`w-full h-px ${isEmerald ? 'bg-emerald-500/30' : 'bg-white/20'}`} />
          <motion.div
            className={`absolute top-0 h-px w-2 ${isEmerald ? 'bg-emerald-400' : 'bg-white/60'}`}
            animate={{ x: [-8, 32] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      )}
    </motion.div>
  );
};

// Stage component
const FlowStage: FC<{
  stage: FlowStage;
  index: number;
  hoveredNode: string | null;
  onNodeHover: (id: string | null) => void;
}> = ({ stage, index, hoveredNode, onNodeHover }) => {
  const isEmerald = stage.color === 'emerald';

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.2, duration: 0.6 }}
    >
      {/* Stage header */}
      <div className="mb-4 flex items-center gap-3">
        {/* Pulsing indicator */}
        <div className="relative">
          <div className={`w-3 h-3 rounded-full ${isEmerald ? 'bg-emerald-500' : 'bg-white/60'}`} />
          <motion.div
            className={`absolute inset-0 rounded-full ${isEmerald ? 'bg-emerald-500' : 'bg-white'}`}
            animate={{
              scale: [1, 2, 1],
              opacity: [0.5, 0, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>

        <div>
          <div className={`text-xs font-mono tracking-widest ${
            isEmerald ? 'text-emerald-400' : 'text-white/40'
          }`}>
            {stage.title}
          </div>
          <div className={`text-[10px] ${
            isEmerald ? 'text-emerald-500/60' : 'text-white/30'
          }`}>
            {stage.subtitle}
          </div>
        </div>
      </div>

      {/* Stage border glow */}
      <div className="relative">
        <div
          className={`absolute -inset-px rounded-2xl opacity-50 blur-sm ${
            isEmerald ? 'bg-emerald-500/20' : 'bg-white/5'
          }`}
        />

        {/* Nodes container */}
        <div className={`relative rounded-2xl border p-4 ${
          isEmerald
            ? 'bg-emerald-950/20 border-emerald-500/20'
            : 'bg-white/[0.02] border-white/10'
        }`}>
          {/* Grid pattern background */}
          <div
            className="absolute inset-0 opacity-[0.03] rounded-2xl"
            style={{
              backgroundImage: `linear-gradient(${isEmerald ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.5)'} 1px, transparent 1px),
                               linear-gradient(90deg, ${isEmerald ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.5)'} 1px, transparent 1px)`,
              backgroundSize: '20px 20px',
            }}
          />

          {/* Nodes grid */}
          <div className={`relative grid gap-3 ${
            stage.nodes.length === 2 ? 'grid-cols-2' :
            stage.nodes.length === 3 ? 'grid-cols-3' :
            'grid-cols-2 md:grid-cols-4'
          }`}>
            {stage.nodes.map((node, nodeIndex) => (
              <FlowNodeCard
                key={node.id}
                node={node}
                stageColor={stage.color}
                index={nodeIndex}
                totalNodes={stage.nodes.length}
                isHovered={hoveredNode === node.id}
                onHover={onNodeHover}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export const DataFlowDiagram: FC = () => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-advance animation
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 14);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl overflow-hidden"
    >
      {/* Background with animated gradient */}
      <div className="absolute inset-0 bg-black">
        {/* Radial gradient */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: 'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.1) 0%, transparent 50%)',
          }}
        />

        {/* Animated noise texture */}
        <motion.div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
          animate={{
            x: [0, 10, 0],
            y: [0, 10, 0],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      </div>

      {/* Border */}
      <div className="absolute inset-0 rounded-2xl border border-white/10" />

      {/* Content */}
      <div className="relative p-6 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <motion.div
                className="absolute inset-0 rounded-full bg-emerald-500"
                animate={{ scale: [1, 2.5], opacity: [0.8, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
            <span className="text-[10px] font-mono text-white/40 tracking-widest">LIVE DATA FLOW</span>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-mono text-white/30">
            <span>STEP {activeStep + 1}/13</span>
            <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-white/40 rounded-full"
                animate={{ width: `${((activeStep + 1) / 13) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        </div>

        {/* Stages */}
        <div className="space-y-0">
          {stages.map((stage, index) => (
            <div key={stage.id}>
              <FlowStage
                stage={stage}
                index={index}
                hoveredNode={hoveredNode}
                onNodeHover={setHoveredNode}
              />
              {index < stages.length - 1 && (
                <ConnectionLine />
              )}
            </div>
          ))}
        </div>

        {/* Legend */}
        <motion.div
          className="mt-8 pt-6 border-t border-white/5 flex flex-wrap items-center justify-center gap-6 text-[10px] text-white/40"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 1 }}
        >
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border border-white/20 bg-white/5" />
            <span>Standard Operation</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border border-emerald-500/30 bg-emerald-500/10" />
            <span>Private Settlement</span>
          </div>
          <div className="flex items-center gap-2">
            <motion.div
              className="w-3 h-0.5 bg-white/40"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span>Data Flow</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
