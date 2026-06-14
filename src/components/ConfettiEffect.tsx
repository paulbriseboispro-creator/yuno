import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Particle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  color: string;
  size: number;
  velocity: { x: number; y: number };
}

interface ConfettiEffectProps {
  trigger: boolean;
  duration?: number;
  particleCount?: number;
}

const COLORS = [
  'hsl(0, 85%, 50%)',   // Primary red
  'hsl(0, 70%, 60%)',   // Light red
  'hsl(45, 100%, 60%)', // Gold
  'hsl(0, 0%, 100%)',   // White
  'hsl(0, 85%, 40%)',   // Dark red
];

export function ConfettiEffect({ 
  trigger, 
  duration = 3000, 
  particleCount = 50 
}: ConfettiEffectProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (trigger && !isActive) {
      setIsActive(true);
      
      // Generate particles
      const newParticles: Particle[] = Array.from({ length: particleCount }, (_, i) => ({
        id: i,
        x: 50 + (Math.random() - 0.5) * 20, // Start from center-ish
        y: 30,
        rotation: Math.random() * 360,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: 4 + Math.random() * 6,
        velocity: {
          x: (Math.random() - 0.5) * 15,
          y: Math.random() * -10 - 5
        }
      }));
      
      setParticles(newParticles);
      
      // Clear after duration
      const timer = setTimeout(() => {
        setParticles([]);
        setIsActive(false);
      }, duration);
      
      return () => clearTimeout(timer);
    }
  }, [trigger, duration, particleCount, isActive]);

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      <AnimatePresence>
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            initial={{ 
              left: `${particle.x}%`, 
              top: `${particle.y}%`,
              rotate: particle.rotation,
              opacity: 1,
              scale: 1
            }}
            animate={{ 
              left: `${particle.x + particle.velocity.x * 10}%`,
              top: '120%',
              rotate: particle.rotation + 720,
              opacity: 0,
              scale: 0.5
            }}
            exit={{ opacity: 0 }}
            transition={{ 
              duration: 2 + Math.random(), 
              ease: [0.25, 0.46, 0.45, 0.94] 
            }}
            className="absolute"
            style={{
              width: particle.size,
              height: particle.size * 0.6,
              backgroundColor: particle.color,
              borderRadius: '2px',
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
