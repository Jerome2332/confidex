'use client';

import { FC, useState, useEffect, useRef } from 'react';
import { ChartArea } from './chart-area';
import { OrderBook } from './order-book';
import { TradingPanel } from './trading-panel';
import { OpenOrders } from './open-orders';
import { BalanceDisplay } from './balance-display';
import { BarChart3, BookOpen, ListOrdered, X, ChevronUp } from 'lucide-react';

type MobileTab = 'chart' | 'book' | 'orders';

interface MobileTradeViewProps {
  className?: string;
}

interface Tab {
  id: MobileTab;
  label: string;
  icon: typeof BarChart3;
}

const tabs: Tab[] = [
  { id: 'chart', label: 'Chart', icon: BarChart3 },
  { id: 'book', label: 'Book', icon: BookOpen },
  { id: 'orders', label: 'Orders', icon: ListOrdered },
];

export const MobileTradeView: FC<MobileTradeViewProps> = ({ className = '' }) => {
  const [activeTab, setActiveTab] = useState<MobileTab>('chart');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number>(0);
  const currentTranslateY = useRef<number>(0);

  // Handle sheet drag
  const handleDragStart = (e: React.TouchEvent | React.MouseEvent) => {
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartY.current = clientY;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  };

  const handleDrag = (e: React.TouchEvent | React.MouseEvent) => {
    if (!sheetRef.current) return;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaY = clientY - dragStartY.current;

    if (deltaY > 0) {
      currentTranslateY.current = deltaY;
      sheetRef.current.style.transform = `translateY(${deltaY}px)`;
    }
  };

  const handleDragEnd = () => {
    if (!sheetRef.current) return;
    sheetRef.current.style.transition = 'transform 0.3s ease-out';

    if (currentTranslateY.current > 100) {
      setIsSheetOpen(false);
    }

    sheetRef.current.style.transform = '';
    currentTranslateY.current = 0;
  };

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (isSheetOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSheetOpen]);

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${className}`}>
      {/* Tab selector */}
      <div className="flex border-b border-border shrink-0">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm transition-colors ${
                activeTab === tab.id
                  ? 'text-primary border-b-2 border-primary -mb-[2px]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chart' && <ChartArea />}
        {activeTab === 'book' && (
          <div className="h-full overflow-auto">
            <OrderBook />
          </div>
        )}
        {activeTab === 'orders' && (
          <div className="h-full overflow-auto p-4 space-y-4">
            <OpenOrders />
            <BalanceDisplay />
          </div>
        )}
      </div>

      {/* Floating trade button */}
      <div className="absolute bottom-4 left-4 right-4 z-40">
        <button
          onClick={() => setIsSheetOpen(true)}
          className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-semibold text-lg shadow-lg hover:bg-primary/90 active:scale-[0.98] transition-all"
        >
          Trade SOL/USDC
        </button>
      </div>

      {/* Bottom sheet overlay */}
      {isSheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsSheetOpen(false)}
        />
      )}

      {/* Bottom sheet */}
      <div
        ref={sheetRef}
        className={`fixed inset-x-0 bottom-0 z-50 bg-background rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
          isSheetOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ height: '85vh', maxHeight: '85vh' }}
      >
        {/* Sheet handle */}
        <div
          className="flex items-center justify-center py-3 cursor-grab active:cursor-grabbing"
          onTouchStart={handleDragStart}
          onTouchMove={handleDrag}
          onTouchEnd={handleDragEnd}
          onMouseDown={handleDragStart}
          onMouseMove={handleDrag}
          onMouseUp={handleDragEnd}
        >
          <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-border">
          <h2 className="text-lg font-semibold">Place Order</h2>
          <button
            onClick={() => setIsSheetOpen(false)}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sheet content */}
        <div className="h-[calc(100%-60px)] overflow-y-auto pb-8">
          <TradingPanel />
        </div>
      </div>
    </div>
  );
};
