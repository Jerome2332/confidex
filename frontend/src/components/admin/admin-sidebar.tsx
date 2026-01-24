'use client';

/**
 * Admin Sidebar
 *
 * Navigation sidebar for admin pages.
 * Uses Phosphor icons and follows brand guidelines.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFour,
  Gear,
  Heartbeat,
  ShieldSlash,
  Sliders,
  List,
  X,
} from '@phosphor-icons/react';
import { useState } from 'react';

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: SquaresFour, exact: true },
  { href: '/admin/crank', label: 'Crank Service', icon: Gear },
  { href: '/admin/health', label: 'System Health', icon: Heartbeat },
  { href: '/admin/blacklist', label: 'Blacklist', icon: ShieldSlash },
  { href: '/admin/config', label: 'Configuration', icon: Sliders },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) => {
    if (exact) {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const NavContent = () => (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href, item.exact);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setIsMobileOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              active
                ? 'bg-white/10 text-white'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon size={20} weight={active ? 'fill' : 'regular'} />
            <span className="font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="fixed top-4 left-4 z-50 p-2 bg-white/10 rounded-lg md:hidden"
        aria-label="Open menu"
      >
        <List size={24} className="text-white" />
      </button>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-40 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar - mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-black border-r border-white/10 transform transition-transform md:hidden ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <span className="text-lg font-medium text-white">Admin</span>
          <button
            onClick={() => setIsMobileOpen(false)}
            className="p-1 hover:bg-white/10 rounded"
            aria-label="Close menu"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>
        <div className="p-4">
          <NavContent />
        </div>
      </aside>

      {/* Sidebar - desktop */}
      <aside className="hidden md:flex md:flex-col md:w-64 bg-black border-r border-white/10">
        <div className="p-4 border-b border-white/10">
          <span className="text-lg font-medium text-white">Admin Panel</span>
        </div>
        <div className="flex-1 p-4 overflow-y-auto">
          <NavContent />
        </div>
      </aside>
    </>
  );
}
