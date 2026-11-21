import React from "react";
import { cn } from "@/lib/utils";

export interface LogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses: Record<NonNullable<LogoProps["size"]>, string> = {
  xs: "h-5 w-5",
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
};

export function Logo({ size = "md", className, alt = "Pippzo Logo", ...props }: LogoProps) {
  return (
    <img
      src="/logo.png"
      alt={alt}
      className={cn(
        "rounded-full object-cover shrink-0 select-none",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
