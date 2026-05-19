import * as React from 'react';
import { cn } from '@/lib/utils';

function Badge({ className, variant = 'default', children, ...props }) {
  if (variant === 'success') {
    return <span className={cn('status-led is-live', className)} aria-hidden="true" title={children} {...props} />;
  }
  if (variant === 'secondary') {
    return <span className={cn('status-led is-idle', className)} aria-hidden="true" title={children} {...props} />;
  }
  return (
    <span className={cn('hint', className)} {...props}>
      {children}
    </span>
  );
}

export { Badge };
