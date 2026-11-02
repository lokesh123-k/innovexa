import { cn } from '@/lib/utils';

/** The official Innovexa Digital logo, used as supplied (1080 × 1050 JPEG). Single source for the whole app. */
export const LOGO_SRC = '/innovex.logo.jpeg';
export const LOGO_ALT = 'Innovexa Digital Logo';

const SIZES = {
  sm: 'h-9', // compact headers
  md: 'h-14', // receipts, mobile auth header
  lg: 'h-24', // sidebar
  xl: 'h-40', // auth hero panel
} as const;

/**
 * Renders the official logo without cropping or distortion: fixed height, width
 * from the intrinsic aspect ratio, `object-contain`. The artwork has its own dark
 * background, so it is shown as a rounded badge on every surface.
 */
export function Logo({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <img
      src={LOGO_SRC}
      alt={LOGO_ALT}
      width={1080}
      height={1050}
      decoding="async"
      className={cn(
        // self-start: never let a flex/grid parent stretch the box to its width.
        'aspect-[1080/1050] w-auto max-w-full shrink-0 self-start select-none rounded-xl object-contain',
        SIZES[size],
        className,
      )}
      draggable={false}
    />
  );
}
