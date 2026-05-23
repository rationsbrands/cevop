import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}
const Icon = ({
  d,
  size = 16,
  className = '',
}: {
  d: string | string[];
  size?: number;
  className?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {Array.isArray(d) ? d.map((path, i) => <path key={i} d={path} />) : <path d={d} />}
  </svg>
);

export const IconDashboard = (p: IconProps) => (
  <Icon {...p} d={['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10']} />
);
export const IconMenu = (p: IconProps) => <Icon {...p} d={['M3 12h18', 'M3 6h18', 'M3 18h18']} />;
export const IconTables = (p: IconProps) => (
  <Icon {...p} d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
);
export const IconSections = (p: IconProps) => (
  <Icon {...p} d={['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z']} />
);
export const IconOrders = (p: IconProps) => (
  <Icon
    {...p}
    d={[
      'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
      'M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2 2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2z',
      'M9 12h6',
      'M9 16h4',
    ]}
  />
);
export const IconStaff = (p: IconProps) => (
  <Icon
    {...p}
    d={[
      'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
      'M9 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0',
      'M23 21v-2a4 4 0 0 0-3-3.87',
      'M16 3.13a4 4 0 0 1 0 7.75',
    ]}
  />
);
export const IconHelp = (p: IconProps) => (
  <Icon {...p} d={['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0']} />
);
export const IconBranches = (p: IconProps) => (
  <Icon {...p} d={['M2 20h.01', 'M7 20v-4', 'M12 20v-8', 'M17 20V8', 'M22 4v16']} />
);
export const IconSettings = (p: IconProps) => (
  <Icon
    {...p}
    d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
  />
);
export const IconOnboard = (p: IconProps) => <Icon {...p} d={['M12 5v14', 'M5 12h14']} />;
export const IconLogout = (p: IconProps) => (
  <Icon {...p} d={['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9']} />
);
export const IconSun = (p: IconProps) => (
  <Icon
    {...p}
    d={[
      'M12 2v2',
      'M12 20v2',
      'M4.93 4.93l1.41 1.41',
      'M17.66 17.66l1.41 1.41',
      'M2 12h2',
      'M20 12h2',
      'M4.93 19.07l1.41-1.41',
      'M17.66 6.34l1.41-1.41',
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    ]}
  />
);
export const IconMoon = (p: IconProps) => (
  <Icon {...p} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
);
export const IconChevronLeft = (p: IconProps) => <Icon {...p} d="M15 18l-6-6 6-6" />;
export const IconX = (p: IconProps) => <Icon {...p} d={['M18 6L6 18', 'M6 6l12 12']} />;
export const IconOrg = (p: IconProps) => (
  <Icon {...p} d={['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']} />
);
export const IconOverview = (p: IconProps) => (
  <Icon {...p} d={['M18 20V10', 'M12 20V4', 'M6 20v-6']} />
);
