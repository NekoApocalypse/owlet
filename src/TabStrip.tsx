import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function TabStrip({
  active,
  children,
}: {
  active?: string | null;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  function measure() {
    const el = viewport.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((previous) =>
      previous.left === left && previous.right === right
        ? previous
        : { left, right },
    );
  }
  function revealActive() {
    const el = viewport.current,
      tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab) return;
    const bounds = el.getBoundingClientRect(),
      item = tab.getBoundingClientRect();
    const inset = 8;
    if (
      item.width > el.clientWidth - inset * 2 ||
      item.left < bounds.left + inset
    )
      el.scrollLeft += item.left - bounds.left - inset;
    else if (item.right > bounds.right - inset)
      el.scrollLeft += item.right - bounds.right + inset;
    measure();
  }
  useLayoutEffect(revealActive, [active]);
  useLayoutEffect(measure, [children]);
  useEffect(() => {
    const el = viewport.current!;
    const resize = new ResizeObserver(revealActive);
    resize.observe(el);
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || el.scrollWidth <= el.clientWidth)
        return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      el.scrollLeft +=
        delta *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? el.clientWidth
            : 1);
      event.preventDefault();
      measure();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  return (
    <div className="tabs-viewport">
      <div className="tabs" role="tablist" ref={viewport} onScroll={measure}>
        {children}
      </div>
      {overflow.left && (
        <span
          className="tab-overflow tab-overflow-left"
          title="More tabs to the left"
          aria-hidden="true"
        >
          <ChevronLeft size={8} />
        </span>
      )}
      {overflow.right && (
        <span
          className="tab-overflow tab-overflow-right"
          title="More tabs to the right"
          aria-hidden="true"
        >
          <ChevronRight size={8} />
        </span>
      )}
    </div>
  );
}
