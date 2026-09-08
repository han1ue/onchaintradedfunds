"use client";
import { useSyncExternalStore } from "react";
const subscribe = (notify: () => void) => {
  document.addEventListener("visibilitychange",notify);
  return () => document.removeEventListener("visibilitychange",notify);
};
export function usePageVisible() {
  return useSyncExternalStore(subscribe,()=>document.visibilityState!=="hidden",()=>false);
}
