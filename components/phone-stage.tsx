"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image, { type StaticImageData } from "next/image";
import CleanDash from "@/src/assets/web/backgrounds/CleanDash.jpg";
import CardStrip from "@/src/assets/backgrounds/stage/card-strip.png";
import CardTopLeft from "@/src/assets/backgrounds/stage/card-top-left.png";
import CardTopMiddle from "@/src/assets/backgrounds/stage/card-top-middle.png";
import CardTopRight from "@/src/assets/backgrounds/stage/card-top-right.png";
import CenterHighlightButton from "@/src/assets/web/icons/CenterHighlightButton.png";
import ConfigurationIcon from "@/src/assets/web/icons/ConfigurationIcon.png";
import LeftHighlightButton from "@/src/assets/web/icons/LeftHighlightButton.png";
import OwlIcon from "@/src/assets/web/icons/Owlicon.png";
import ReportIcon from "@/src/assets/web/icons/ReportIcon.png";
import RightHighlightButton from "@/src/assets/web/icons/RightHighlightButton.png";
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
  bottom: 10,
  side: 60,
  height: 101,
  gap: 45,

  selectedCoverRadius: 9,
  // The active highlight sits on its slot's panel in the artwork, in stage pixels.
  // The slots' buttons have different widths, so this can't be derived from the button.
  cover: {
    report: { left: 9, top: 731, width: 121, height: 104 },
    dashboard: { left: 135, top: 731, width: 120, height: 104 },
    configuration: { left: 259, top: 731, width: 124, height: 104 },
  },
  icon: {
    report: { offsetX: -10, offsetY: 0, scale: 1.5 },
    dashboard: { offsetX: 0, offsetY: 0, scale: 2.5 },
    configuration: { offsetX: 10, offsetY: 0, scale: 2 },
  },
  label: {
    report: { offsetX: -10, offsetY: 20, scale: 1.6 },
    dashboard: { offsetX: 0, offsetY: 20, scale: 2 },
    configuration: { offsetX: 15, offsetY: 20, scale: 1.6 },
  },
} as const;

const NAV_ITEMS: Array<{
  highlight: StaticImageData;
  icon: StaticImageData;
  id: NavItemId;
  label: string;
  screen: Screen;
}> = [
  { highlight: LeftHighlightButton, icon: ReportIcon, id: "report", label: "Report", screen: "daily-log" },
  { highlight: CenterHighlightButton, icon: OwlIcon, id: "dashboard", label: "Dashboard", screen: "dashboard" },
  {
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

  useEffect(() => {
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

// While typing on a phone: keep the field visible above the keyboard, and report
// it so the dock can step aside and leave the room for the form.
function useTypingInStage(enabled: boolean) {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsTyping(false);
      return;
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;

      if (!isTextField(target)) {
        return;
      }

      setIsTyping(true);
      window.setTimeout(() => {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (isTextField(event.target) && !isTextField(event.relatedTarget)) {
        setIsTyping(false);
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
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
  // On a phone, scrolling screens fill the screen height; the dashboard artwork keeps
  // its fixed height and the page scrolls if the screen is shorter than that.
  const stageHeight =
    isPhone && variant === "screen" ? layout.viewportHeight / layout.scale : STAGE_HEIGHT;

  const stage = (
        <div
          className={`overflow-hidden bg-[#050505] ${
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
          {variant === "artwork" ? (
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
          ) : (
            <>
              <CardBackground />
              <div
                className="absolute inset-x-0 top-0 overflow-y-auto overscroll-contain px-4 pb-24 pt-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                data-stage-scroll
                style={{ bottom: isTyping ? 0 : DOCK_HEIGHT - 14 }}
              >
                {children}
              </div>
              {isTyping ? null : <DockFrame />}
            </>
          )}
          {isTyping ? null : <BottomNavigationDock active={active} onNavigate={onNavigate} />}
        </div>
  );

  if (isPhone) {
    return (
      <div className="fixed inset-0 z-[180] overflow-x-hidden overflow-y-auto overscroll-none bg-black text-[#f7ebda]">
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
    <div className="fixed inset-0 z-[180] overflow-hidden bg-black text-[#f7ebda]">
      <div className="relative h-[100dvh] w-full overflow-hidden bg-black">{stage}</div>
    </div>
  );
}

// The dashboard's card without its contents: the card's top edge, then a clean strip
// of its leather and side borders repeated down to the dock. All pieces are cut from
// CleanDash.png and drawn at the artwork's scale.
const CARD_TOP_HEIGHT = 12;
const CARD_CORNER_WIDTH = 45;
const CARD_STRIP_HEIGHT = 34;

function CardBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
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
  const activeItem = NAV_ITEMS.find((item) => item.screen === active);
  const cover = activeItem ? NAV_POS.cover[activeItem.id] : null;

  return (
    <>
      {activeItem && cover ? (
        <span
          className="pointer-events-none absolute z-[140] overflow-hidden"
          style={{
            borderRadius: NAV_POS.selectedCoverRadius,
            height: cover.height,
            left: cover.left,
            top: cover.top,
            width: cover.width,
          }}
        >
          <Image alt="" className="object-fill" fill priority sizes="130px" src={activeItem.highlight} />
        </span>
      ) : null}
      <nav
        className="absolute z-[150]"
        style={{
          bottom: NAV_POS.bottom,
          height: NAV_POS.height,
          left: NAV_POS.side,
          right: NAV_POS.side,
        }}
      >
        <div className="grid h-full grid-cols-3" style={{ gap: NAV_POS.gap }}>
          {NAV_ITEMS.map((item) => (
            <div key={item.id} className="h-full">
              <BottomNavItem
                active={item.screen === active}
                icon={item.icon}
                id={item.id}
                label={item.label}
                onClick={() => onNavigate?.(item.screen)}
              />
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}

function BottomNavItem({
  active,
  icon,
  id,
  label,
  onClick,
}: {
  active: boolean;
  icon: StaticImageData;
  id: NavItemId;
  label: string;
  onClick: () => void;
}) {
  const iconPos = NAV_POS.icon[id];
  const labelPos = NAV_POS.label[id];

  return (
    <button
      aria-current={active ? "page" : undefined}
      // No gold-text class on the button: a text-clipped background here would paint the
      // (scaled) label a second time at its unscaled position.
      className="relative flex h-full min-w-0 flex-col items-center justify-center gap-1 overflow-visible px-1"
      onClick={onClick}
      type="button"
    >
      <span
        className="relative h-8 w-8"
        style={{
          transform: `translate(${iconPos.offsetX}px, ${iconPos.offsetY}px) scale(${iconPos.scale})`,
        }}
      >
        <Image alt="" className="object-contain" fill sizes="32px" src={icon} />
      </span>
      <span
        className={`relative w-full overflow-visible whitespace-nowrap text-center text-[10px] font-semibold leading-[1.15] ${
          active ? "dashboard-nav-active-text" : "dashboard-gold-label"
        }`}
        style={{
          transform: `translate(${labelPos.offsetX}px, ${labelPos.offsetY}px) scale(${labelPos.scale})`,
        }}
      >
        {label}
      </span>
    </button>
  );
}
