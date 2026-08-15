import troCodeLogo from '../assets/trocode-logo.png';

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  const classes = ['brand-mark', className].filter(Boolean).join(' ');

  return (
    <img
      alt=""
      aria-hidden="true"
      className={classes}
      draggable={false}
      src={troCodeLogo}
    />
  );
}
