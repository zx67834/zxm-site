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
    let running = false;
    let pointer = { x: -999, y: -999 };
    const nodes: { x: number; y: number; vx: number; vy: number }[] = [];
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let palette = { background: "246, 248, 247", line: "77, 124, 105", dot: "48, 109, 84" };

    const readPalette = () => {
      const styles = getComputedStyle(document.documentElement);
      palette = {
        background: styles.getPropertyValue("--node-bg-rgb").trim() || palette.background,
        line: styles.getPropertyValue("--node-line-rgb").trim() || palette.line,
        dot: styles.getPropertyValue("--node-dot-rgb").trim() || palette.dot,
      };
      if (width && height) {
        ctx.fillStyle = `rgb(${palette.background})`;
        ctx.fillRect(0, 0, width, height);
      }
    };

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
      const mobile = width < 720;
      const count = Math.min(
        mobile ? 64 : 168,
        Math.max(mobile ? 34 : 48, Math.floor((width * height) / (mobile ? 9000 : 6200))),
      );
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
        });
      }
      ctx.fillStyle = `rgb(${palette.background})`;
      ctx.fillRect(0, 0, width, height);
    };

    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const draw = () => {
      if (!running) return;
      ctx.fillStyle = `rgba(${palette.background}, .28)`;
      ctx.fillRect(0, 0, width, height);
      for (const node of nodes) {
        if (!motionQuery.matches) {
          node.x += node.vx;
          node.y += node.vy;
        }
        if (node.x < 5 || node.x > width - 5) node.vx *= -1;
        if (node.y < 5 || node.y > height - 5) node.vy *= -1;
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (distance < 120) {
            ctx.strokeStyle = `rgba(${palette.line}, ${(1 - distance / 120) * 0.25})`;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
        const hover = Math.hypot(nodes[i].x - pointer.x, nodes[i].y - pointer.y);
        if (hover < 155) {
          ctx.strokeStyle = `rgba(${palette.dot}, ${(1 - hover / 155) * 0.55})`;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = `rgba(${palette.dot}, .68)`;
      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!motionQuery.matches && !document.hidden) frame = requestAnimationFrame(draw);
      else running = false;
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const start = () => {
      stop();
      running = true;
      draw();
    };

    const onVisibilityChange = () => document.hidden ? stop() : start();
    const onMotionChange = () => start();

    readPalette();
    resize();
    start();
    const observer = new ResizeObserver(() => {
      resize();
      start();
    });
    const themeObserver = new MutationObserver(() => {
      readPalette();
      start();
    });
    observer.observe(host);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", () => (pointer = { x: -999, y: -999 }));
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", onMotionChange);
    return () => {
      stop();
      observer.disconnect();
      themeObserver.disconnect();
      host.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="node-field" aria-hidden="true" />;
}
