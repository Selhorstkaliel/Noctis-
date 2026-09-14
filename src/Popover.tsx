import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./components";

/** A non-modal, anchored panel. The conversation remains interactive. */
export function Popover({
  id,
  anchor,
  title,
  closeLabel,
  onClose,
  children,
}: {
  id: string;
  anchor: RefObject<HTMLButtonElement | null>;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  }>();
  useLayoutEffect(() => {
    const element = panel.current;
    const trigger = anchor.current;
    if (!element || !trigger) return;
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const height = Math.min(element.scrollHeight, 420);
      const flip = below < height && above > below;
      const maxHeight = Math.max(0, Math.min(420, flip ? above : below));
      const next = {
        width,
        maxHeight,
        left: Math.max(
          12,
          Math.min(rect.right - width, window.innerWidth - width - 12),
        ),
        top: Math.max(
          12,
          flip ? rect.top - 8 - Math.min(height, maxHeight) : rect.bottom + 8,
        ),
      };
      setPosition((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const outside = (event: Event) => {
      if (
        !element.contains(event.target as Node) &&
        !trigger.contains(event.target as Node)
      )
        close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
      trigger.focus({ preventScroll: true });
    };
    const scroll = (event: Event) => {
      if (!element.contains(event.target as Node)) close.current();
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(element);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [anchor]);
  const positioned = position !== undefined;
  useLayoutEffect(() => {
    if (positioned) panel.current?.focus({ preventScroll: true });
  }, [positioned]);
  return createPortal(
    <div
      id={id}
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      className="anchored-popover"
      style={{ ...position, visibility: position ? "visible" : "hidden" }}
    >
      <div className="popover-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <IconButton
          name="X"
          label={closeLabel}
          onClick={() => {
            onClose();
            anchor.current?.focus({ preventScroll: true });
          }}
        />
      </div>
      <div className="popover-body">{children}</div>
    </div>,
    document.body,
  );
}
