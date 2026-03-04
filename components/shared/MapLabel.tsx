import React from 'react';

export interface MapLabelProps {
    text: string;
    subtitle?: string;
    size?: 'sm' | 'md' | 'lg';
    borderColor?: string;
    bgColor?: string;
}

const SIZE_CLASSES = {
    sm: 'text-[11px] px-2 py-0.5 font-semibold',
    md: 'text-xs px-2.5 py-1 font-bold',
    lg: 'text-[13px] px-4 py-1.5 font-extrabold',
} as const;

export const MapLabel: React.FC<MapLabelProps> = ({
    text,
    subtitle,
    bgColor = '#111827',
    borderColor = 'rgba(255,255,255,0.85)',
    size = 'md',
}) => {
    return (
        <div
            className={`${SIZE_CLASSES[size]} whitespace-nowrap rounded leading-tight`}
            style={{
                background: bgColor,
                color: 'white',
                border: `1.5px solid ${borderColor}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
        >
            <div>{text}</div>
            {subtitle && (
                <div className="text-[10px] font-medium text-gray-300 mt-0.5">{subtitle}</div>
            )}
        </div>
    );
};
