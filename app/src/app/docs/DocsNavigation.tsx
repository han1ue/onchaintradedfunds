"use client";

import { BookOpen, ChevronDown, Menu } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type DocsSectionGroup = {
  readonly label: string;
  readonly sections: readonly (readonly [id: string, label: string])[];
};

export function DocsNavigation({ groups }: { groups: readonly DocsSectionGroup[] }) {
  const sectionIds = useMemo(
    () => groups.flatMap((group) => group.sections.map(([id]) => id)),
    [groups],
  );
  const [activeId, setActiveId] = useState(sectionIds[0] ?? "");
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    let frame = 0;
    let disposed = false;

    const updateActiveSection = () => {
      frame = 0;
      const bannerHeight = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--testnet-banner-height"),
      ) || 0;
      const readingLine = bannerHeight + 112;
      let nextActive = sectionIds[0] ?? "";

      for (const id of sectionIds) {
        const section = document.getElementById(id);
        if (!section || section.getBoundingClientRect().top > readingLine) break;
        nextActive = id;
      }

      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        nextActive = sectionIds.at(-1) ?? nextActive;
      }
      setActiveId((current) => current === nextActive ? current : nextActive);
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    const delayedUpdate = window.setTimeout(updateActiveSection, 500);
    const sectionObserver = new IntersectionObserver(scheduleUpdate, {
      rootMargin: "-15% 0px -70% 0px",
      threshold: [0, 0.01],
    });
    sectionIds.forEach((id) => {
      const section = document.getElementById(id);
      if (section) sectionObserver.observe(section);
    });
    document.fonts?.ready.then(() => {
      if (!disposed) scheduleUpdate();
    });
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("hashchange", scheduleUpdate);
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(delayedUpdate);
      sectionObserver.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("hashchange", scheduleUpdate);
    };
  }, [sectionIds]);

  const navigation = (mobile = false) => (
    <nav className={mobile ? undefined : "docsDesktopNav"} aria-label="Documentation sections">
      {groups.map((group) => (
        <div className="docsNavGroup" key={group.label}>
          <span className="docsNavGroupLabel">{group.label}</span>
          {group.sections.map(([id, label]) => (
            <a
              className={activeId === id ? "active" : undefined}
              href={`#${id}`}
              aria-current={activeId === id ? "location" : undefined}
              key={id}
              onClick={() => {
                setActiveId(id);
                if (mobileMenuRef.current) mobileMenuRef.current.open = false;
              }}
            >
              {label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <aside className="docsSidebar">
      <div className="docsSidebarTitle">
        <BookOpen size={15} />
        Documentation index
      </div>
      {navigation()}
      <div className="docsStatus">
        <span />
        <div>
          <strong>MVP documentation</strong>
          <small>Robinhood Testnet</small>
        </div>
      </div>
      <details className="docsMobileMenu" ref={mobileMenuRef}>
        <summary>
          <Menu size={16} />
          <span>Documentation index</span>
          <ChevronDown size={15} />
        </summary>
        {navigation(true)}
      </details>
    </aside>
  );
}
