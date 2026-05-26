import React from 'react';

interface AutoFitTextProps {
  children: React.ReactNode;
  maxFontSize?: string;
  minFontSize?: string;
  className?: string;
}

/**
 * AutoFitText component that scales its content to fit the container width.
 * Uses CSS Container Queries for performance and responsiveness.
 */
export const AutoFitText: React.FC<AutoFitTextProps> = ({
  children,
  maxFontSize = '2.25rem',
  minFontSize = '0.625rem',
  className = '',
}) => {
  const text = React.Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');

  const length = text.length || 1;
  const characterWidthFactor = 0.8;
  const scaledFontSize = `calc(100cqi / (${Math.max(length, 5)} * ${characterWidthFactor}))`;

  return (
    <div style={{ containerType: 'inline-size' }} className="w-full overflow-hidden">
      <p
        className={`whitespace-nowrap leading-tight transition-[font-size] duration-200 ${className}`}
        style={{
          fontSize: `clamp(${minFontSize}, ${scaledFontSize}, ${maxFontSize})`,
        }}
        title={text}
      >
        {children}
      </p>
    </div>
  );
};
