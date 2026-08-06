"use client";

import { useEffect } from "react";

export function InputBehaviorGuard() {
  useEffect(() => {
    function stopWheelEditing(event: WheelEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        && target.type === "number"
        && document.activeElement === target
      ) {
        target.blur();
      }
    }

    document.addEventListener("wheel", stopWheelEditing, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", stopWheelEditing, true);
  }, []);

  return null;
}
