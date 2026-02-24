import React from "react";

interface BrandProps {
  compact?: boolean;
  inverse?: boolean;
}

export const Brand = ({ compact = false, inverse = false }: BrandProps) => {
  const gradientId = React.useId();
  const stroke = `url(#${gradientId})`;

  return (
    <div className="flex items-center gap-3">
      <div className={`relative flex h-12 w-12 items-center justify-center ${compact ? "" : "rounded-2xl"}`}>
        <svg
          viewBox="0 0 120 120"
          aria-hidden="true"
          className="h-12 w-12 drop-shadow-[0_8px_16px_rgba(74,144,226,0.22)]"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4A90E2" />
              <stop offset="100%" stopColor="#3E7FC8" />
            </linearGradient>
          </defs>
          <path
            d="M60 9c14 9 30 14 45 17c6 25 3 49-5 66c-9 17-24 30-40 37c-17-7-31-20-40-37c-8-17-11-41-5-66c15-3 31-8 45-17z"
            fill="none"
            stroke={stroke}
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M35 44c11-14 31-16 45-3c10 10 21 12 32 3"
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M85 78c-11 14-31 16-45 3c-10-10-21-12-32-3"
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M37 50l46 28"
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {!compact && (
        <div>
          <p className={`text-[2rem] font-extrabold leading-none tracking-tight ${inverse ? "text-white" : "text-[#1A1A1A]"}`}>
            SmartPSI
          </p>
        </div>
      )}
    </div>
  );
};
