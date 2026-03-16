import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  fullPage?: boolean;
}

const sizeMap = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };

export default function LoadingSpinner({ size = 'md', fullPage = false }: LoadingSpinnerProps) {
  if (fullPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className={`${sizeMap[size]} animate-spin text-primary-600`} />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className={`${sizeMap[size]} animate-spin text-primary-600`} />
    </div>
  );
}
