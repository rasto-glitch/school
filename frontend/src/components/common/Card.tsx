import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  onClick?: () => void;
  hover?: boolean;
}

export default function Card({ children, className = '', style, id, onClick, hover = false }: CardProps) {
  return (
    <div
      id={id}
      onClick={onClick}
      style={style}
      className={`
        bg-white rounded-2xl shadow-sm border border-gray-100 p-4
        ${hover ? 'hover:shadow-md hover:border-primary-200 transition-all duration-200 cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
