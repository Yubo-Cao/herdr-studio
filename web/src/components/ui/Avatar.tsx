import * as AvatarPrimitive from "@radix-ui/react-avatar";
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
} from "react";

// Radix composition used by shadcn/ui, styled with Studio's shared tokens.
export const Avatar = forwardRef<
  ElementRef<typeof AvatarPrimitive.Root>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className = "", ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={`ui-avatar ${className}`}
    {...props}
  />
));
Avatar.displayName = "Avatar";
export const AvatarImage = AvatarPrimitive.Image;
export const AvatarFallback = AvatarPrimitive.Fallback;
