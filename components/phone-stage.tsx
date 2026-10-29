"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import Image, { type StaticImageData } from "next/image";
import CleanDash from "@/src/assets/web/backgrounds/CleanDash.webp";
import CardStrip from "@/src/assets/backgrounds/stage/card-strip.png";
import CardTopLeft from "@/src/assets/backgrounds/stage/card-top-left.png";
import CardTopMiddle from "@/src/assets/backgrounds/stage/card-top-middle.png";
import CardTopRight from "@/src/assets/backgrounds/stage/card-top-right.png";
import CenterHighlightButton from "@/src/assets/web/icons/CenterHighlightButton.png";
import ConfigurationIcon from "@/src/assets/web/icons/ConfigurationIcon.png";
import LeftHighlightButton from "@/src/assets/web/icons/LeftHighlightButton.png";
import OpenConfigurationIcon from "@/src/assets/web/icons/OpenConfigurationIcon.png";
import OwlIcon from "@/src/assets/web/icons/Owlicon.png";
import ReportIcon from "@/src/assets/web/icons/ReportIcon.png";
import RightHighlightButton from "@/src/assets/web/icons/RightHighlightButton.png";
import SleepOwlIcon from "@/src/assets/web/icons/SleepOwlicon.png";
import WriteReportIcon from "@/src/assets/web/icons/WriteReportIcon.png";
import type { Screen } from "@/lib/types";

// Every screen is drawn on the same phone-sized stage (the dashboard artwork's size),
// scaled down to fit smaller viewports.
export const STAGE_WIDTH = 390;
export const STAGE_HEIGHT = 844;
const STAGE_VIEWPORT_PADDING = 16;
// Height of the artwork's bottom dock frame, reused on the scrolling screens.
export const DOCK_HEIGHT = 124;

type NavItemId = "report" | "dashboard" | "configuration";

const NAV_POS = {
  selectedCoverRadius: 9,
  // The active highlight sits on its slot's panel in the artwork, in stage pixels.
  // The slots' buttons have different widths, so this can't be derived from the button.
  cover: {
    report: { left: 9, top: 731, width: 121, height: 104 },
    dashboard: { left: 135, top: 731, width: 120, height: 104 },
    configuration: { left: 259, top: 731, width: 124, height: 104 },
  },
  icon: {
    report: { size: 76, top: 2 },
    dashboard: { size: 80, top: 0 },
    configuration: { size: 84, top: 0 },
  },
  label: {
    report: 16,
    dashboard: 20,
    configuration: 16,
  },
} as const;

// Each icon has a selected and an unselected state drawn on the same canvas, so
// switching between them never moves the artwork.
const NAV_ITEMS: Array<{
  activeIcon: StaticImageData;
  highlight: StaticImageData;
  icon: StaticImageData;
  id: NavItemId;
  label: string;
  screen: Screen;
}> = [
  {
    activeIcon: WriteReportIcon,
    highlight: LeftHighlightButton,
    icon: ReportIcon,
    id: "report",
    label: "Report",
    screen: "daily-log",
  },
  {
    activeIcon: OwlIcon,
    highlight: CenterHighlightButton,
    icon: SleepOwlIcon,
    id: "dashboard",
    label: "Dashboard",
    screen: "dashboard",
  },
  {
    activeIcon: OpenConfigurationIcon,
    highlight: RightHighlightButton,
    icon: ConfigurationIcon,
    id: "configuration",
    label: "Configuration",
    screen: "configuration",
  },
];

// Up to this width the app is treated as running on a phone.
const PHONE_MAX_WIDTH = 500;
const PHONE_MAX_SCALE = 1.1;

interface StageLayout {
  // "phone": scaled to the screen width and filling its height. "framed": a fixed
  // 390x844 phone frame scaled to fit a larger (desktop) window.
  mode: "phone" | "framed";
  scale: number;
  viewportHeight: number;
}

function useStageLayout(): StageLayout {
  const [layout, setLayout] = useState<StageLayout>({
    mode: "framed",
    scale: 1,
    viewportHeight: STAGE_HEIGHT,
  });

  useLayoutEffect(() => {
    const updateLayout = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      if (width <= PHONE_MAX_WIDTH) {
        // Scale by width only. Scaling by height too made text tiny on short phones,
        // and the on-screen keyboard must not shrink the whole app.
        setLayout({
          mode: "phone",
          scale: Number(Math.min(PHONE_MAX_SCALE, width / STAGE_WIDTH).toFixed(4)),
          viewportHeight: height,
        });
        return;
      }

      const availableWidth = Math.max(1, width - STAGE_VIEWPORT_PADDING);
      const availableHeight = Math.max(1, height - STAGE_VIEWPORT_PADDING);
      setLayout({
        mode: "framed",
        scale: Number(
          Math.min(1, availableWidth / STAGE_WIDTH, availableHeight / STAGE_HEIGHT).toFixed(4),
        ),
        viewportHeight: height,
      });
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);

    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
    };
  }, []);

  return layout;
}

function isTextField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    target.closest("[data-stage-scroll]") !== null
  );
}

// Scroll only the content pane: scrollIntoView can also scroll clipped ancestors,
// moving the stage and dock. DOM rectangles include the stage's responsive scale.
export function scrollWithinStage(
  target: HTMLElement | null,
  block: "start" | "center" = "start",
) {
  const scroller = target?.closest<HTMLElement>("[data-stage-scroll]");
  if (!target || !scroller || !scroller.offsetHeight) return;

  const pane = scroller.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const scale = pane.height / scroller.offsetHeight;
  if (!scale) return;

  const inset = block === "center"
    ? (scroller.clientHeight - rect.height / scale) / 2
    : parseFloat(getComputedStyle(scroller).paddingTop) || 0;

  scroller.scrollTo({
    top: scroller.scrollTop + (rect.top - pane.top) / scale - scroller.clientTop - inset,
    behavior: "smooth",
  });
}

// Programmatic shortcuts keep their date/month context visible when focus opens
// the keyboard. Ordinary taps still center the field as before.
const focusScrollAnchors = new WeakMap<HTMLElement, HTMLElement>();
export function focusWithinStage(target: HTMLElement | null, anchor: HTMLElement | null) {
  if (!target || !anchor) return;
  focusScrollAnchors.set(target, anchor);
  target.focus({ preventScroll: true });
  focusScrollAnchors.delete(target);
  scrollWithinStage(anchor);
}

// While typing on a phone: keep the field visible above the keyboard, and report
// it so the dock can step aside and leave the room for the form.
function useTypingInStage(enabled: boolean) {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsTyping(false);
      return;
    }

    let focusTimer: number | undefined;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;

      if (!isTextField(target)) {
        return;
      }

      const anchor = focusScrollAnchors.get(target);
      setIsTyping(true);
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        if (document.activeElement === target) scrollWithinStage(anchor ?? target, anchor ? "start" : "center");
      }, 300);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (isTextField(event.target) && !isTextField(event.relatedTarget)) {
        window.clearTimeout(focusTimer);
        setIsTyping(false);
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, [enabled]);

  return isTyping;
}

export function PhoneStage({
  active,
  children,
  onNavigate,
  variant,
}: {
  active: Screen;
  children: ReactNode;
  onNavigate?: (screen: Screen) => void;
  // "artwork": the full dashboard artwork with absolutely placed content.
  // "screen": a scrolling screen with the artwork's dock frame at the bottom.
  variant: "artwork" | "screen";
}) {
  const layout = useStageLayout();
  const isPhone = layout.mode === "phone";
  const isTyping = useTypingInStage(isPhone && variant === "screen");
  // Every phone screen fills the viewport; only its content scrolls above the dock.
  const stageHeight = isPhone ? layout.viewportHeight / layout.scale : STAGE_HEIGHT;
  const artworkContent = (
    <>
      <Image
        alt=""
        className="pointer-events-none object-fill"
        fill
        priority
        sizes="390px"
        src={CleanDash}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,219,172,0.05),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.03),rgba(0,0,0,0.12))]" />
      {children}
    </>
  );

  const stage = (
        <div
          data-phone-stage
          className={`overflow-clip bg-black ${
            isPhone
              ? "absolute left-0 top-0"
              : "absolute left-1/2 top-1/2 rounded-[2rem] shadow-[0_28px_80px_rgba(0,0,0,0.72)]"
          }`}
          // The transform also makes this the containing block for fixed children
          // (toasts, save bar), so they stay inside the stage.
          style={{
            height: stageHeight,
            transform: isPhone
              ? `scale(${layout.scale})`
              : `translate(-50%, -50%) scale(${layout.scale})`,
            transformOrigin: isPhone ? "top left" : "center center",
            width: STAGE_WIDTH,
          }}
        >
          <CardBackground bottom={isTyping ? 0 : DOCK_HEIGHT} />
          <div
            key={active}
            className={`stage-screen-enter absolute inset-x-0 top-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
              variant === "screen" ? "px-4 pb-24 pt-5" : ""
            }`}
            data-stage-scroll
            style={{ bottom: isTyping ? 0 : variant === "artwork" ? DOCK_HEIGHT : DOCK_HEIGHT - 14 }}
          >
            {variant === "artwork" ? (
              <div className="relative overflow-hidden" style={{ height: STAGE_HEIGHT - DOCK_HEIGHT }}>
                <div className="relative bg-black" style={{ height: STAGE_HEIGHT }}>
                  {artworkContent}
                </div>
              </div>
            ) : children}
          </div>
          {isTyping ? null : <DockFrame />}
          {isTyping ? null : <BottomNavigationDock active={active} onNavigate={onNavigate} />}
        </div>
  );

  if (isPhone) {
    return (
      <div className="fixed inset-0 z-[180] overflow-clip bg-black text-[#f7ebda]">
        <div
          className="relative mx-auto"
          style={{
            height: stageHeight * layout.scale,
            width: STAGE_WIDTH * layout.scale,
          }}
        >
          {stage}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[180] overflow-clip bg-black text-[#f7ebda]">
      <div className="relative h-[100dvh] w-full overflow-clip bg-black">{stage}</div>
    </div>
  );
}

// The dashboard's card without its contents: the card's top edge, then a clean strip
// of its leather and side borders repeated down to the dock. All pieces are cut from
// CleanDash.png and drawn at the artwork's scale.
const CARD_TOP_HEIGHT = 12;
const CARD_CORNER_WIDTH = 45;
const CARD_STRIP_HEIGHT = 34;

function CardBackground({ bottom = DOCK_HEIGHT }: { bottom?: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ bottom }}>
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          backgroundImage: `url(${CardStrip.src})`,
          backgroundRepeat: "repeat-y",
          backgroundSize: `${STAGE_WIDTH}px ${CARD_STRIP_HEIGHT}px`,
          top: CARD_TOP_HEIGHT,
        }}
      />
      <div
        className="absolute left-0 top-0"
        style={{
          backgroundImage: `url(${CardTopLeft.src})`,
          backgroundSize: "100% 100%",
          height: CARD_TOP_HEIGHT,
          width: CARD_CORNER_WIDTH,
        }}
      />
      {/* Stretched rather than tiled: the edge is a horizontal line, so this has no seams. */}
      <div
        className="absolute top-0"
        style={{
          backgroundImage: `url(${CardTopMiddle.src})`,
          backgroundSize: "100% 100%",
          height: CARD_TOP_HEIGHT,
          left: CARD_CORNER_WIDTH,
          right: CARD_CORNER_WIDTH,
        }}
      />
      <div
        className="absolute right-0 top-0"
        style={{
          backgroundImage: `url(${CardTopRight.src})`,
          backgroundSize: "100% 100%",
          height: CARD_TOP_HEIGHT,
          width: CARD_CORNER_WIDTH,
        }}
      />
    </div>
  );
}

// The bottom slice of the dashboard artwork, drawn at the same scale, so the dock
// frame is pixel-identical on every screen.
function DockFrame() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden"
      style={{ height: DOCK_HEIGHT }}
    >
      <div className="absolute bottom-0 left-0" style={{ height: STAGE_HEIGHT, width: STAGE_WIDTH }}>
        <Image alt="" className="object-fill" fill priority sizes="390px" src={CleanDash} />
      </div>
    </div>
  );
}

export function BottomNavigationDock({
  active,
  onNavigate,
}: {
  active: Screen;
  onNavigate?: (screen: Screen) => void;
}) {
  return (
    <nav
      aria-label="Main navigation"
      className="absolute inset-x-0 bottom-0 z-[150]"
      style={{ height: DOCK_HEIGHT }}
    >
      {NAV_ITEMS.map((item) => (
        <BottomNavItem
          key={item.id}
          active={item.screen === active}
          activeIcon={item.activeIcon}
          highlight={item.highlight}
          icon={item.icon}
          id={item.id}
          label={item.label}
          onClick={() => onNavigate?.(item.screen)}
        />
      ))}
    </nav>
  );
}

function BottomNavItem({
  active,
  activeIcon,
  highlight,
  icon,
  id,
  label,
  onClick,
}: {
  active: boolean;
  activeIcon: StaticImageData;
  highlight: StaticImageData;
  icon: StaticImageData;
  id: NavItemId;
  label: string;
  onClick: () => void;
}) {
  const iconPos = NAV_POS.icon[id];
  const tile = NAV_POS.cover[id];

  return (
    <button
      aria-current={active ? "page" : undefined}
      // No gold-text class on the button: a text-clipped background here would paint the
      // (scaled) label a second time at its unscaled position.
      className="absolute rounded-[9px] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#ffe6b1]"
      style={{
        left: tile.left,
        bottom: STAGE_HEIGHT - tile.top - tile.height,
        width: tile.width,
        height: tile.height,
      }}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none ${active ? "opacity-100" : "opacity-0"}`}
        style={{ borderRadius: NAV_POS.selectedCoverRadius }}
      >
        <Image alt="" className="object-fill" fill priority sizes="130px" src={highlight} />
      </span>
      <span
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ top: iconPos.top, width: iconPos.size, height: iconPos.size }}
      >
        {/* Both states stay loaded and cross-fade, so the first switch doesn't flash. */}
        {[
          { shown: !active, src: icon },
          { shown: active, src: activeIcon },
        ].map((state) => (
          <Image
            key={state.src.src}
            alt=""
            aria-hidden="true"
            className={`pointer-events-none object-contain transition-opacity duration-200 ease-out motion-reduce:transition-none ${
              state.shown ? "opacity-100" : "opacity-0"
            }`}
            fill
            sizes="84px"
            src={state.src}
          />
        ))}
      </span>
      <span
        className={`pointer-events-none absolute inset-x-0 bottom-1 whitespace-nowrap text-center font-semibold leading-[1.15] ${
          active ? "dashboard-nav-active-text" : "dashboard-gold-label"
        }`}
        style={{
          fontSize: NAV_POS.label[id],
        }}
      >
        {label}
      </span>
    </button>
  );
}
