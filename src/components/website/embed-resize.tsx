"use client";

import { useEffect } from "react";

/**
 * Posts the embed's height to the parent page ({ type: "dlang:resize", height })
 * so /embed.js (or the WordPress plugin) can size the iframe. The target
 * origin is the parent origin the server validated against the club's
 * allowed origins; without one nothing is posted.
 */
export function EmbedResize({ parentOrigin }: { parentOrigin: string | null }) {
  useEffect(() => {
    if (!parentOrigin || window.parent === window) return;
    let last = 0;
    const post = () => {
      const h = Math.ceil(document.documentElement.scrollHeight);
      if (h === last) return;
      last = h;
      window.parent.postMessage({ type: "dlang:resize", height: h }, parentOrigin);
    };
    post();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(post) : null;
    ro?.observe(document.body);
    window.addEventListener("load", post);
    return () => {
      ro?.disconnect();
      window.removeEventListener("load", post);
    };
  }, [parentOrigin]);
  return null;
}
