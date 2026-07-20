"use client";

import { useEffect, useRef } from "react";

export default function NodeField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let pointer = { x: -999, y: -999 };
    const nodes: { x: number; y: number; vx: number; vy: number }[] = [];

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodes.length = 0;
      const count = Math.min(240, Math.max(115, Math.floor((width * height) / 4800)));
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
        });
      }
    };

    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const draw = () => {
      ctx.fillStyle = "rgba(7, 20, 13, .28)";
      ctx.fillRect(0, 0, width, height);
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 5 || node.x > width - 5) node.vx *= -1;
        if (node.y < 5 || node.y > height - 5) node.vy *= -1;
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (distance < 120) {
            ctx.strokeStyle = `rgba(54, 154, 91, ${(1 - distance / 120) * 0.34})`;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
        const hover = Math.hypot(nodes[i].x - pointer.x, nodes[i].y - pointer.y);
        if (hover < 155) {
          ctx.strokeStyle = `rgba(113, 220, 150, ${(1 - hover / 155) * 0.72})`;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(103, 205, 138, .86)";
      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", () => (pointer = { x: -999, y: -999 }));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("pointermove", move);
    };
  }, []);

  return <canvas ref={canvasRef} className="node-field" aria-hidden="true" />;
}
