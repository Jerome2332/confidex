/**
 * Market category detection and utilities
 * Auto-categorizes markets based on question keywords
 */

export type MarketCategory = 'crypto' | 'politics' | 'tech' | 'sports' | 'other';

export interface CategoryConfig {
  id: MarketCategory;
  label: string;
  keywords: string[];
}

export const CATEGORIES: CategoryConfig[] = [
  {
    id: 'crypto',
    label: 'Crypto',
    keywords: [
      'btc', 'bitcoin', 'eth', 'ethereum', 'sol', 'solana', 'token', 'crypto',
      'defi', 'nft', 'blockchain', 'usdc', 'usdt', 'stablecoin', 'dex', 'cex',
      'binance', 'coinbase', 'price', 'market cap', 'tvl', 'airdrop', 'mint',
      'swap', 'liquidity', 'yield', 'staking', 'validator', 'mainnet', 'testnet',
      'layer 2', 'l2', 'rollup', 'bridge', 'wallet', 'arcium', 'phantom'
    ],
  },
  {
    id: 'politics',
    label: 'Politics',
    keywords: [
      'election', 'president', 'congress', 'senate', 'vote', 'ballot', 'poll',
      'democrat', 'republican', 'governor', 'mayor', 'legislation', 'bill',
      'policy', 'government', 'political', 'campaign', 'candidate', 'party',
      'primary', 'nominee', 'inauguration', 'impeachment', 'supreme court'
    ],
  },
  {
    id: 'tech',
    label: 'Tech',
    keywords: [
      'ai', 'artificial intelligence', 'gpt', 'openai', 'claude', 'llm',
      'launch', 'release', 'app', 'software', 'startup', 'ipo', 'acquisition',
      'merger', 'apple', 'google', 'microsoft', 'meta', 'amazon', 'tesla',
      'spacex', 'neuralink', 'robotics', 'autonomous', 'chip', 'gpu', 'nvidia',
      'quantum', 'vr', 'ar', 'metaverse', 'api', 'sdk', 'open source'
    ],
  },
  {
    id: 'sports',
    label: 'Sports',
    keywords: [
      'win', 'championship', 'game', 'team', 'nba', 'nfl', 'mlb', 'nhl',
      'soccer', 'football', 'basketball', 'baseball', 'hockey', 'tennis',
      'golf', 'olympics', 'world cup', 'super bowl', 'playoffs', 'finals',
      'mvp', 'championship', 'league', 'tournament', 'match', 'score',
      'player', 'coach', 'draft', 'trade', 'contract', 'season'
    ],
  },
];

/**
 * Categorize a market based on its question text
 * Returns the category with the most keyword matches
 */
export function categorizeMarket(question: string): MarketCategory {
  const lowerQuestion = question.toLowerCase();

  let bestCategory: MarketCategory = 'other';
  let bestScore = 0;

  for (const category of CATEGORIES) {
    let score = 0;
    for (const keyword of category.keywords) {
      if (lowerQuestion.includes(keyword.toLowerCase())) {
        // Give higher weight to longer, more specific keywords
        score += keyword.length > 5 ? 2 : 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = category.id;
    }
  }

  return bestCategory;
}

/**
 * Get category config by ID
 */
export function getCategoryConfig(category: MarketCategory): CategoryConfig | undefined {
  return CATEGORIES.find(c => c.id === category);
}

/**
 * Get category label for display
 */
export function getCategoryLabel(category: MarketCategory): string {
  const config = getCategoryConfig(category);
  return config?.label ?? 'Other';
}

/**
 * All category options including "All"
 */
export const ALL_CATEGORY_OPTIONS: { id: MarketCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  ...CATEGORIES.map(c => ({ id: c.id, label: c.label })),
  { id: 'other', label: 'Other' },
];

/**
 * Sort options for market list
 */
export type SortOption = 'ending-soon' | 'newest' | 'alphabetical';

export const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'ending-soon', label: 'Ending Soon' },
  { id: 'newest', label: 'Newest' },
  { id: 'alphabetical', label: 'A-Z' },
];

/**
 * Format time remaining with urgency indicators
 */
export function formatTimeRemaining(endTime: Date): { text: string; urgent: boolean } {
  const now = new Date();
  const diffMs = endTime.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { text: 'Ended', urgent: false };
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffDays > 30) {
    const months = Math.floor(diffDays / 30);
    return { text: `${months} month${months > 1 ? 's' : ''}`, urgent: false };
  }

  if (diffDays > 7) {
    const weeks = Math.floor(diffDays / 7);
    return { text: `${weeks} week${weeks > 1 ? 's' : ''}`, urgent: false };
  }

  if (diffDays > 1) {
    return { text: `${diffDays} days`, urgent: diffDays <= 3 };
  }

  if (diffDays === 1) {
    return { text: '1 day', urgent: true };
  }

  if (diffHours > 1) {
    return { text: `${diffHours} hours`, urgent: true };
  }

  if (diffHours === 1) {
    return { text: '1 hour', urgent: true };
  }

  return { text: `${diffMinutes} min`, urgent: true };
}
