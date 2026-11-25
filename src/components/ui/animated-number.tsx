"use client";

import { useEffect } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

export function AnimatedNumber({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const spring = useSpring(value, { stiffness: 90, damping: 22, mass: 0.6 });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  return <motion.span className={className}>{text}</motion.span>;
}
