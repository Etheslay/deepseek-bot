/**
 * Drag handle on the desktop sidebar's trailing edge. Width is applied as
 * the `--sidebar-width` custom property so the header offset follows the
 * column. The bot list itself is unchanged.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { t } from "../../i18n.js";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MIN,
  displaySidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
  sidebarWidthFromDrag,
  sidebarWidthFromKey,
  sidebarWidthLimit,
} from "./sidebar-width.js";

const WIDTH_VAR = "--sidebar-width";

function applySidebarWidth(px: number): void {
  document.documentElement.style.setProperty(WIDTH_VAR, `${px}px`);
}

export function SidebarResizer(): JSX.Element {
  const handleRef = useRef<HTMLDivElement>(null);
  const persistedRef = useRef(loadSidebarWidth(window.localStorage));
  const dragRef = useRef<number | null>(null);
  const [width, setWidth] = useState(() =>
    displaySidebarWidth(persistedRef.current, window.innerWidth),
  );
  const [limit, setLimit] = useState(() => sidebarWidthLimit(window.innerWidth));
  const [dragging, setDragging] = useState(false);

  const publish = (visible: number): void => {
    applySidebarWidth(visible);
    setWidth(visible);
    setLimit(sidebarWidthLimit(window.innerWidth));
  };

  const commit = (visible: number): void => {
    dragRef.current = null;
    persistedRef.current = saveSidebarWidth(window.localStorage, visible);
    publish(displaySidebarWidth(persistedRef.current, window.innerWidth));
    setDragging(false);
    document.documentElement.classList.remove("sidebar-resizing");
  };

  useLayoutEffect(() => {
    const visible =
      dragRef.current ?? displaySidebarWidth(persistedRef.current, window.innerWidth);
    applySidebarWidth(visible);
  });

  useEffect(() => {
    const onResize = (): void => {
      setLimit(sidebarWidthLimit(window.innerWidth));
      if (dragRef.current !== null) {
        return;
      }
      setWidth(displaySidebarWidth(persistedRef.current, window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      document.documentElement.classList.remove("sidebar-resizing");
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    const aside = event.currentTarget.parentElement;
    if (aside === null) {
      return;
    }
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = aside.getBoundingClientRect().width;
    let latest = startWidth;
    let moved = false;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    document.documentElement.classList.add("sidebar-resizing");

    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== event.pointerId) {
        return;
      }
      moved = true;
      latest = sidebarWidthFromDrag(startWidth, move.clientX - startX, window.innerWidth);
      dragRef.current = latest;
      applySidebarWidth(latest);
      handle.setAttribute("aria-valuenow", String(latest));
      handle.setAttribute("aria-valuemax", String(sidebarWidthLimit(window.innerWidth)));
    };
    const end = (endEvent: PointerEvent): void => {
      if (endEvent.pointerId !== event.pointerId) {
        return;
      }
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (!moved) {
        dragRef.current = null;
        setDragging(false);
        document.documentElement.classList.remove("sidebar-resizing");
        applySidebarWidth(displaySidebarWidth(persistedRef.current, window.innerWidth));
        return;
      }
      commit(latest);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const aside = event.currentTarget.parentElement;
    const current = aside?.getBoundingClientRect().width ?? width;
    const next = sidebarWidthFromKey(current, event.key, window.innerWidth, event.shiftKey);
    if (next === null) {
      return;
    }
    event.preventDefault();
    commit(next);
  };

  const onDoubleClick = (): void => {
    commit(SIDEBAR_WIDTH_DEFAULT);
  };

  const visible = dragRef.current ?? width;

  return (
    <div
      ref={handleRef}
      className={dragging ? "sidebar-resizer dragging" : "sidebar-resizer"}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("shell.resizeSidebar")}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={limit}
      aria-valuenow={visible}
      tabIndex={0}
      title={t("shell.resizeSidebar")}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
