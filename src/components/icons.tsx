/**
 * The app's icon set, mapped onto lucide-react.
 *
 * Every glyph renders at `1em` and inherits `currentColor`, so callers size and
 * colour them with Tailwind text utilities (`text-[15px]`, `text-slate-500`).
 * Stroke weight is dialled back from lucide's default 2 to suit the small sizes
 * used throughout; pass `strokeWidth` to override one.
 */
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  Copy,
  CornerDownLeft,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Keyboard,
  Languages,
  Maximize2,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

function icon(Glyph: LucideIcon) {
  return function Icon(props: LucideProps) {
    return <Glyph size="1em" strokeWidth={1.75} aria-hidden {...props} />;
  };
}

export const LanguagesIcon = icon(Languages);
export const SwapIcon = icon(ArrowRightLeft);
export const CopyIcon = icon(Copy);
export const CheckIcon = icon(Check);
export const CloseIcon = icon(X);
export const SearchIcon = icon(Search);
export const PinIcon = icon(Pin);
export const UnpinIcon = icon(PinOff);
export const TrashIcon = icon(Trash2);
export const SettingsIcon = icon(Settings);
export const ClockIcon = icon(Clock);
export const KeyIcon = icon(KeyRound);
export const KeyboardIcon = icon(Keyboard);
export const ExternalIcon = icon(ExternalLink);
export const ChevronDownIcon = icon(ChevronDown);
export const EnterIcon = icon(CornerDownLeft);
export const ExpandIcon = icon(Maximize2);
export const AlertIcon = icon(CircleAlert);
export const ResetIcon = icon(RotateCcw);
export const EyeIcon = icon(Eye);
export const EyeOffIcon = icon(EyeOff);
