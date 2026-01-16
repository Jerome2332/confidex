'use client';

import { useState, useEffect, useRef } from 'react';
import { HermesClient } from '@pythnetwork/hermes-client';

import { createLogger } from '@/lib/logger';

const log = createLogger('hooks');

// Pyth Price Feed IDs
// Full list: https://pyth.network/developers/price-feed-ids
const PRICE_FEED_IDS = {
  'SOL/USD': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'USDC/USD': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
} as const;

export type PriceFeedId = keyof typeof PRICE_FEED_IDS;

export interface PriceData {
  price: number;
  confidence: number;
  publishTime: Date;
  emaPrice: number;
  emaConfidence: number;
}

export interface PythPriceState {
  prices: Record<PriceFeedId, PriceData | null>;
  isLoading: boolean;
  error: string | null;
  lastUpdate: Date | null;
  isStreaming: boolean;
}

// Pyth SDK types (matching Zod schema from @pythnetwork/hermes-client)
interface PythPriceComponent {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
}

interface PythPriceUpdate {
  id: string;
  price: PythPriceComponent;
  ema_price?: PythPriceComponent;
}

const HERMES_ENDPOINT = 'https://hermes.pyth.network';

// Parse Pyth price data into a usable format
function parsePriceData(priceUpdate: PythPriceUpdate): PriceData | null {
  try {
    const price = priceUpdate.price;
    if (!price) return null;

    const priceValue = Number(price.price) * Math.pow(10, price.expo);
    const confidenceValue = Number(price.conf) * Math.pow(10, price.expo);

    const ema = priceUpdate.ema_price;
    const emaPriceValue = ema ? Number(ema.price) * Math.pow(10, ema.expo) : priceValue;
    const emaConfidenceValue = ema ? Number(ema.conf) * Math.pow(10, ema.expo) : confidenceValue;

    return {
      price: priceValue,
      confidence: confidenceValue,
      publishTime: new Date(Number(price.publish_time) * 1000),
      emaPrice: emaPriceValue,
      emaConfidence: emaConfidenceValue,
    };
  } catch (error) {
    log.error('Error parsing price data', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export function usePythPrice(feedIds: PriceFeedId[] = ['SOL/USD']) {
  const [state, setState] = useState<PythPriceState>({
    prices: {
      'SOL/USD': null,
      'USDC/USD': null,
    },
    isLoading: true,
    error: null,
    lastUpdate: null,
    isStreaming: false,
  });

  // Use refs to avoid stale closures and ensure proper cleanup
  const clientRef = useRef<HermesClient | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(false);
  const isStreamingRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Stringify feedIds for stable dependency
  const feedIdsKey = feedIds.join(',');

  useEffect(() => {
    // Mark as mounted
    mountedRef.current = true;

    // Create client
    const client = new HermesClient(HERMES_ENDPOINT, {});
    clientRef.current = client;

    // Fetch prices function
    const fetchPrices = async () => {
      if (!mountedRef.current || !clientRef.current) return;

      try {
        setState(prev => ({ ...prev, isLoading: prev.prices['SOL/USD'] === null, error: null }));

        const priceIds = feedIds.map(id => PRICE_FEED_IDS[id]);
        const priceUpdates = await clientRef.current.getLatestPriceUpdates(priceIds);

        if (!mountedRef.current) return;

        const newPrices: Record<PriceFeedId, PriceData | null> = {
          'SOL/USD': null,
          'USDC/USD': null,
        };

        priceUpdates.parsed?.forEach((update: PythPriceUpdate, index: number) => {
          const feedId = feedIds[index];
          newPrices[feedId] = parsePriceData(update);
        });

        setState(prev => ({
          ...prev,
          prices: { ...prev.prices, ...newPrices },
          isLoading: false,
          lastUpdate: new Date(),
        }));
      } catch (error) {
        log.error('Error fetching prices', { error: error instanceof Error ? error.message : String(error) });
        if (mountedRef.current) {
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to fetch prices',
          }));
        }
      }
    };

    // Start streaming function
    const startStreaming = async () => {
      if (!mountedRef.current || !clientRef.current || eventSourceRef.current) return;

      try {
        const priceIds = feedIds.map(id => PRICE_FEED_IDS[id]);
        const eventSource = await clientRef.current.getPriceUpdatesStream(priceIds, {
          parsed: true,
          allowUnordered: true,
          benchmarksOnly: false,
        });

        // Check if still mounted after async operation
        if (!mountedRef.current) {
          eventSource.close();
          return;
        }

        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
          if (!mountedRef.current) return;

          try {
            const data = JSON.parse(event.data);

            if (data.parsed) {
              const newPrices: Partial<Record<PriceFeedId, PriceData | null>> = {};

              data.parsed.forEach((update: PythPriceUpdate) => {
                const feedIdHex = '0x' + update.id;
                const matchedFeed = feedIds.find(
                  id => PRICE_FEED_IDS[id].toLowerCase() === feedIdHex.toLowerCase()
                );

                if (matchedFeed) {
                  newPrices[matchedFeed] = parsePriceData(update);
                }
              });

              if (Object.keys(newPrices).length > 0) {
                setState(prev => ({
                  ...prev,
                  prices: { ...prev.prices, ...newPrices },
                  lastUpdate: new Date(),
                  isStreaming: true,
                }));
                isStreamingRef.current = true;
              }
            }
          } catch (parseError) {
            log.error('Error parsing SSE message', { error: parseError instanceof Error ? parseError.message : String(parseError) });
          }
        };

        eventSource.onerror = () => {
          if (mountedRef.current) {
            setState(prev => ({ ...prev, isStreaming: false }));
            isStreamingRef.current = false;
          }
        };

        eventSource.onopen = () => {
          if (mountedRef.current) {
            setState(prev => ({ ...prev, isStreaming: true }));
            isStreamingRef.current = true;
          }
        };
      } catch (error) {
        log.error('Error starting stream', { error: error instanceof Error ? error.message : String(error) });
      }
    };

    // Initial fetch
    fetchPrices();

    // Start streaming after delay
    streamTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        startStreaming();
      }
    }, 1000);

    // Fallback polling - use ref to check streaming status
    pollIntervalRef.current = setInterval(() => {
      if (mountedRef.current && !isStreamingRef.current) {
        fetchPrices();
      }
    }, 10000);

    // Cleanup function
    return () => {
      // Mark as unmounted FIRST
      mountedRef.current = false;
      isStreamingRef.current = false;

      // Clear timers
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      // Close EventSource synchronously
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch (e) {
          // Ignore close errors
        }
        eventSourceRef.current = null;
      }

      // Clear client
      clientRef.current = null;
    };
  }, [feedIdsKey]); // Only re-run if feedIds change

  const solPrice = state.prices['SOL/USD']?.price ?? null;
  const solPriceData = state.prices['SOL/USD'];

  return {
    ...state,
    solPrice,
    solPriceData,
    price: solPrice,
    priceData: solPriceData,
  };
}

// Simpler hook for just SOL/USD price
export function useSolPrice() {
  const result = usePythPrice(['SOL/USD']);

  return {
    price: result.solPrice,
    priceData: result.solPriceData,
    isLoading: result.isLoading,
    error: result.error,
    isStreaming: result.isStreaming,
    lastUpdate: result.lastUpdate,
  };
}
