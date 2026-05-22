import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef(({ className, type = 'text', ...props }, ref) => (
  <input type={type} className={cn('sena-field', className)} ref={ref} {...props} />
));
Input.displayName = 'Input';

export { Input };
