import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

const variantClass = {
  default: 'primary',
  destructive: 'danger',
  outline: 'primary ghost',
  secondary: 'primary ghost',
  ghost: 'btn-mini ghost',
  link: '',
};

const sizeClass = {
  default: '',
  sm: 'btn-mini',
  lg: '',
  icon: 'btn-mini',
};

const Button = React.forwardRef(({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(variantClass[variant], sizeClass[size], variant === 'link' && 'auth-links', className)}
      ref={ref}
      {...props}
    />
  );
});
Button.displayName = 'Button';

export { Button };
