import React from 'react';

import { cn } from '@/lib/utils';

// {/* <img
// src="../assets/icons/icon.png"
// alt="CoForce Apply Icon"
// className="w-6 h-6 mr-2"
// onError={e => {
//   console.error('Icon failed to load:', e);
//   // Try alternative path
//   e.currentTarget.src = 'assets/icons/icon.png';
// }}
// /> */}
export default function Logo({
  className,
  size = '6',
  ...props
}: React.ComponentProps<'img'> & { className?: string; size?: string }) {
  return (
    <img
      src="../assets/icons/icon.png"
      alt="CoForce Apply Icon"
      className={cn(`w-${size} h-${size} mr-2`, className)}
      onError={e => {
        console.error('Icon failed to load:', e);
        // Try alternative path
        e.currentTarget.src = 'assets/icons/icon.png';
      }}
      {...props}
    />
  );
}
