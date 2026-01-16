'use client';

import { FC, useState, useRef, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface DropdownItem {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
}

interface NavDropdownProps {
  label: string;
  items: DropdownItem[];
  basePath: string;
}

export const NavDropdown: FC<NavDropdownProps> = ({ label, items, basePath }) => {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pathname = usePathname();
  const isActive = pathname.startsWith(basePath);

  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  }, []);

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger Button */}
      <button
        className={`flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg transition-colors ${
          isActive
            ? 'font-medium bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
        }`}
      >
        {label}
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-card border border-border rounded-lg shadow-lg p-1.5 z-50">
          {items.map((item) => {
            const Icon = item.icon;
            const isItemActive = pathname === item.href ||
              (item.href !== basePath && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-start gap-3 p-3 rounded-md transition-colors ${
                  isItemActive
                    ? 'bg-primary/10'
                    : 'hover:bg-secondary/50'
                }`}
                onClick={() => setIsOpen(false)}
              >
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                  <Icon className={`h-5 w-5 ${isItemActive ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${isItemActive ? 'text-primary' : 'text-foreground'}`}>
                    {item.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {item.description}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
