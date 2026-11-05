import { useEffect, useRef, type ReactNode } from "react";

/** Native keyboard/touch disclosure on phones; the same controls stay open on desktop. */
export function ResponsiveDisclosure({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 639px), (max-width: 900px) and (max-height: 560px)");
    const update = () => { if (ref.current) ref.current.open = !phone.matches; };
    update();
    phone.addEventListener("change", update);
    return () => phone.removeEventListener("change", update);
  }, []);
  return <details ref={ref} className={className}>
    <summary>{label}<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m8 10 4 4 4-4" /></svg></summary>
    <div className={`${className}-content`}>{children}</div>
  </details>;
}
