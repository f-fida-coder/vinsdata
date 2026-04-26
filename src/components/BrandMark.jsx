/*
 * Vin Vault brand mark — inlined SVG so it scales without a network round-trip
 * and inherits theme tokens. Source of truth: public/brand/vinvault-favicon.svg
 * fetched from vinvault.us. Two glyphs render the canted "V V" pair on a
 * rounded square. The lockup with the wordmark lives at /brand/vinvault-logo.svg
 * (an img-tag asset for the login page).
 */
export default function BrandMark({ size = 28, variant = 'dark', className }) {
  const isDark = variant === 'dark';
  const tile = isDark ? '#0A0A0A' : '#F4F4F5';
  const ink  = isDark ? '#F4F4F5' : '#0A0A0A';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="12" fill={tile} />
      <path d="M18 44L31 20H36L24 44H18Z" fill={ink} />
      <path d="M29 44L42 20H47L35 44H29Z" fill={ink} />
    </svg>
  );
}
