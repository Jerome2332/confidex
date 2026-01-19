'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { MarketCard, MarketCardSkeleton } from '@/components/market-card';
import { usePredictions } from '@/hooks/use-predictions';

import { createLogger } from '@/lib/logger';
import {
  ALL_CATEGORY_OPTIONS,
  SORT_OPTIONS,
  type MarketCategory,
  type SortOption,
} from '@/lib/market-categories';

const log = createLogger('ui');
import {
  SpinnerGap,
  Plus,
  X,
  Calendar,
  CurrencyDollar,
  Sparkle,
  WarningCircle,
  MagnifyingGlass,
  CheckCircle,
  SlidersHorizontal,
  GithubLogo,
  BookOpen,
  CaretDown,
} from '@phosphor-icons/react';

// Date preset utilities
const getDatePresets = () => {
  const now = new Date();

  // 1 week from now
  const oneWeek = new Date(now);
  oneWeek.setDate(oneWeek.getDate() + 7);
  oneWeek.setHours(23, 59, 0, 0);

  // 1 month from now
  const oneMonth = new Date(now);
  oneMonth.setMonth(oneMonth.getMonth() + 1);
  oneMonth.setHours(23, 59, 0, 0);

  // 3 months from now
  const threeMonths = new Date(now);
  threeMonths.setMonth(threeMonths.getMonth() + 3);
  threeMonths.setHours(23, 59, 0, 0);

  // End of current quarter
  const currentQuarter = Math.floor(now.getMonth() / 3);
  const endOfQuarter = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0, 23, 59, 0, 0);

  // End of year
  const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 0, 0);

  return [
    { label: '1 Week', date: oneWeek },
    { label: '1 Month', date: oneMonth },
    { label: '3 Months', date: threeMonths },
    { label: 'End of Q' + (currentQuarter + 1), date: endOfQuarter },
    { label: 'End of Year', date: endOfYear },
  ];
};

// Question templates
const questionTemplates = [
  { label: 'Price Target', template: 'Will {TOKEN} reach ${PRICE} by {DATE}?' },
  { label: 'Protocol Launch', template: 'Will {PROTOCOL} launch on mainnet by {DATE}?' },
  { label: 'Event Outcome', template: 'Will {EVENT} happen by {DATE}?' },
  { label: 'Metric Goal', template: 'Will {METRIC} exceed {VALUE} by {DATE}?' },
];

// Format date for datetime-local input
const formatDateForInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// Format date for display
const formatDateForDisplay = (dateStr: string): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const MAX_QUESTION_LENGTH = 200;
const MIN_QUESTION_LENGTH = 10;

export default function PredictPage() {
  const router = useRouter();
  const {
    filteredMarkets,
    isLoadingMarkets,
    isSearching,
    refreshMarkets,
    searchMarkets,
    categoryFilter,
    setCategoryFilter,
    sortBy,
    setSortBy,
    createNewMarket,
    isCreatingMarket,
  } = usePredictions();

  const [searchQuery, setSearchQuery] = useState('');
  const [totalMarketsCount, setTotalMarketsCount] = useState<number | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Debounced server-side search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);

    // Clear existing timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Debounce the search call
    debounceRef.current = setTimeout(() => {
      if (value.trim()) {
        searchMarkets(value);
      } else {
        // Clear search - reload all markets
        refreshMarkets();
      }
    }, 300);
  }, [searchMarkets, refreshMarkets]);

  // Track total markets count when not searching
  useEffect(() => {
    if (!searchQuery.trim() && filteredMarkets.length > 0) {
      setTotalMarketsCount(filteredMarkets.length);
    }
  }, [filteredMarkets.length, searchQuery]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Close sort dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowSortDropdown(false);
    if (showSortDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showSortDropdown]);

  // Create market modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newMarketQuestion, setNewMarketQuestion] = useState('');
  const [newMarketEndDate, setNewMarketEndDate] = useState('');
  const [newMarketLiquidity, setNewMarketLiquidity] = useState('100');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const datePresets = useMemo(() => getDatePresets(), []);

  const questionCharCount = newMarketQuestion.length;
  const isQuestionValid = questionCharCount >= MIN_QUESTION_LENGTH && questionCharCount <= MAX_QUESTION_LENGTH;

  const handleCreateMarket = async () => {
    if (!newMarketQuestion.trim() || !newMarketEndDate || !newMarketLiquidity) {
      setCreateError('Please fill in all fields');
      return;
    }

    if (!isQuestionValid) {
      setCreateError(`Question must be between ${MIN_QUESTION_LENGTH} and ${MAX_QUESTION_LENGTH} characters`);
      return;
    }

    const endTime = new Date(newMarketEndDate);
    if (endTime <= new Date()) {
      setCreateError('End date must be in the future');
      return;
    }

    const liquidity = parseFloat(newMarketLiquidity);
    if (isNaN(liquidity) || liquidity <= 0) {
      setCreateError('Liquidity must be a positive number');
      return;
    }

    setCreateError(null);
    setCreateSuccess(null);

    try {
      const market = await createNewMarket(newMarketQuestion.trim(), endTime, liquidity);
      setCreateSuccess(`Market created: ${market.id.toBase58().slice(0, 8)}...`);

      // Navigate to the new market after short delay
      setTimeout(() => {
        setShowCreateModal(false);
        setNewMarketQuestion('');
        setNewMarketEndDate('');
        setNewMarketLiquidity('100');
        setCreateSuccess(null);
        router.push(`/predict/${market.id.toBase58()}`);
      }, 1500);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create market');
    }
  };

  const handleDatePresetClick = (date: Date) => {
    setNewMarketEndDate(formatDateForInput(date));
  };

  const handleTemplateClick = (template: string) => {
    setNewMarketQuestion(template);
  };

  const resetModal = () => {
    setShowCreateModal(false);
    setNewMarketQuestion('');
    setNewMarketEndDate('');
    setNewMarketLiquidity('100');
    setCreateError(null);
    setCreateSuccess(null);
  };

  return (
    <main className="min-h-screen bg-black">
      <Header />

      <div className="container mx-auto px-4 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-light text-white">Prediction Markets</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/20 hover:border-white/40 text-white/80 hover:text-white transition-colors"
          >
            <Plus size={16} />
            <span className="text-sm font-medium">Create Market</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative mb-6">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search all markets..."
            className="w-full pl-10 pr-10 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-colors"
          />
          {isSearching && (
            <SpinnerGap size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/40" />
          )}
          {!isSearching && searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filter and Sort Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          {/* Category filters */}
          <div className="flex flex-wrap items-center gap-2">
            {ALL_CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setCategoryFilter(option.id as MarketCategory | 'all')}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  categoryFilter === option.id
                    ? 'border-white/30 bg-white/10 text-white'
                    : 'border-white/10 text-white/50 hover:text-white hover:border-white/20'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowSortDropdown(!showSortDropdown);
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors"
            >
              <SlidersHorizontal size={16} />
              <span>Sort: {SORT_OPTIONS.find(o => o.id === sortBy)?.label}</span>
              <CaretDown size={16} className={`transition-transform ${showSortDropdown ? 'rotate-180' : ''}`} />
            </button>
            {showSortDropdown && (
              <div className="absolute right-0 mt-2 w-48 py-1 bg-black border border-white/20 rounded-lg shadow-xl z-10">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setSortBy(option.id);
                      setShowSortDropdown(false);
                    }}
                    className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                      sortBy === option.id
                        ? 'bg-white/10 text-white'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Search results info */}
        {searchQuery && totalMarketsCount && (
          <p className="text-xs text-white/40 mb-4">
            Found {filteredMarkets.length} markets matching "{searchQuery}"
          </p>
        )}

        {/* Markets Grid */}
        {isLoadingMarkets && !isSearching ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredMarkets.length === 0 && !searchQuery ? (
          <div className="border border-white/10 rounded-xl p-12 text-center">
            <p className="text-white/60 mb-4">No active markets</p>
            <p className="text-sm text-white/40 mb-6">
              Markets will appear here once they are created via the PNP protocol.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black hover:bg-white/90 transition-colors"
            >
              <Plus size={16} />
              Create First Market
            </button>
          </div>
        ) : filteredMarkets.length === 0 && searchQuery ? (
          <div className="border border-white/10 rounded-xl p-12 text-center">
            <p className="text-white/60 mb-2">No markets match "{searchQuery}"</p>
            <button
              onClick={() => handleSearchChange('')}
              className="text-sm text-white/40 hover:text-white/60 underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredMarkets.map((market) => (
              <MarketCard key={market.id.toBase58()} market={market} />
            ))}
          </div>
        )}
      </div>

      {/* Create Market Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) resetModal();
          }}
        >
          <div className="bg-black border border-white/20 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h3 className="text-xl font-light text-white">Create Prediction Market</h3>
                <p className="text-sm text-white/40 mt-1">Define a yes/no question with a resolution date</p>
              </div>
              <button
                onClick={resetModal}
                className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Question Section */}
              <div>
                <label className="flex items-center justify-between text-sm mb-2">
                  <span className="text-white/60 font-medium">Market Question</span>
                  <span className={`text-xs font-mono ${
                    questionCharCount === 0
                      ? 'text-white/30'
                      : questionCharCount < MIN_QUESTION_LENGTH
                        ? 'text-rose-400/80'
                        : questionCharCount > MAX_QUESTION_LENGTH
                          ? 'text-rose-400/80'
                          : 'text-white/40'
                  }`}>
                    {questionCharCount}/{MAX_QUESTION_LENGTH}
                  </span>
                </label>
                <textarea
                  value={newMarketQuestion}
                  onChange={(e) => setNewMarketQuestion(e.target.value)}
                  placeholder="Will SOL reach $300 by end of Q2 2026?"
                  rows={3}
                  maxLength={MAX_QUESTION_LENGTH + 50}
                  className="w-full p-4 rounded-lg border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 resize-none transition-colors"
                />
                <p className="text-xs text-white/40 mt-2">
                  Ask a clear yes/no question that can be objectively resolved
                </p>

                {/* Question Templates */}
                <div className="mt-3">
                  <p className="text-xs text-white/40 mb-2 flex items-center gap-1">
                    <Sparkle size={12} />
                    Quick templates
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {questionTemplates.map((t) => (
                      <button
                        key={t.label}
                        onClick={() => handleTemplateClick(t.template)}
                        className="px-3 py-1.5 text-xs rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 hover:bg-white/5 transition-colors"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* End Date Section */}
              <div>
                <label className="flex items-center gap-2 text-sm text-white/60 font-medium mb-2">
                  <Calendar size={16} />
                  Resolution Date
                </label>

                {/* Date Presets */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {datePresets.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => handleDatePresetClick(preset.date)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                        newMarketEndDate && formatDateForInput(preset.date) === newMarketEndDate
                          ? 'border-white/30 bg-white/10 text-white'
                          : 'border-white/10 text-white/50 hover:text-white hover:border-white/20 hover:bg-white/5'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Custom Date Input */}
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={newMarketEndDate}
                    onChange={(e) => setNewMarketEndDate(e.target.value)}
                    min={formatDateForInput(new Date())}
                    className="w-full p-4 rounded-lg border border-white/10 bg-white/5 text-white focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-colors [color-scheme:dark]"
                  />
                </div>

                {/* Selected Date Display */}
                {newMarketEndDate && (
                  <div className="mt-2 p-3 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-sm text-white/60">
                      Market resolves: <span className="text-white font-medium">{formatDateForDisplay(newMarketEndDate)}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Initial Liquidity Section */}
              <div>
                <label className="flex items-center gap-2 text-sm text-white/60 font-medium mb-2">
                  <CurrencyDollar size={16} />
                  Initial Liquidity
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={newMarketLiquidity}
                    onChange={(e) => setNewMarketLiquidity(e.target.value)}
                    placeholder="100"
                    min="1"
                    className="w-full p-4 pr-16 rounded-lg border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-colors"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 text-sm font-medium">
                    USDC
                  </span>
                </div>
                <p className="text-xs text-white/40 mt-2">
                  Liquidity is split 50/50 into YES and NO tokens. Higher liquidity means less price impact.
                </p>

                {/* Quick Liquidity Presets */}
                <div className="flex gap-2 mt-2">
                  {[50, 100, 250, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setNewMarketLiquidity(String(amt))}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        newMarketLiquidity === String(amt)
                          ? 'border-white/30 bg-white/10 text-white'
                          : 'border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error Message */}
              {createError && (
                <div className="flex items-start gap-3 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg">
                  <WarningCircle size={20} className="text-rose-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-rose-400/80">Error</p>
                    <p className="text-sm text-rose-400/60 mt-0.5">{createError}</p>
                  </div>
                </div>
              )}

              {/* Success Message */}
              {createSuccess && (
                <div className="flex items-start gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                  <CheckCircle size={20} className="text-emerald-400/80 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-400/80">Success</p>
                    <p className="text-sm text-emerald-400/60 mt-0.5">{createSuccess}</p>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                onClick={handleCreateMarket}
                disabled={isCreatingMarket || !isQuestionValid || !newMarketEndDate}
                className="w-full p-4 rounded-lg font-medium bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20"
              >
                {isCreatingMarket ? (
                  <span className="flex items-center justify-center gap-2">
                    <SpinnerGap size={20} className="animate-spin" />
                    Creating Market...
                  </span>
                ) : (
                  'Create Market'
                )}
              </button>

              <p className="text-xs text-white/40 text-center">
                Markets are created on PNP devnet with Pythagorean AMM pricing.
                <br />
                A 1% fee applies to all trades.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/10 py-6 mt-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6 text-sm text-white/40">
              <span>Built for Solana Privacy Hack 2026</span>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  <GithubLogo size={16} />
                </a>
                <a
                  href="https://docs.arcium.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  <BookOpen size={16} />
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/40">
              <span>Powered by</span>
              <span className="bg-white/10 px-2 py-0.5 rounded">Arcium MPC</span>
              <span className="bg-white/10 px-2 py-0.5 rounded">Noir ZK</span>
              <span className="bg-white/10 px-2 py-0.5 rounded">ShadowWire</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
