'use client';

/**
 * Admin Layout
 *
 * Layout wrapper for all admin pages.
 * Provides sidebar navigation and header with API key input.
 */

import { AdminSidebar, AdminHeader } from '@/components/admin';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black flex">
      <AdminSidebar />
      <div className="flex-1 flex flex-col md:ml-0">
        <AdminHeader />
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
