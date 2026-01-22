/**
 * Build Content Security Policy
 * @returns {string} CSP header value
 */
function buildCSP() {
  const isDev = process.env.NODE_ENV !== 'production';

  const directives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'", // Required for Next.js
      isDev ? "'unsafe-eval'" : '', // Required for Next.js dev
      'https://va.vercel-scripts.com',
      'https://s3.tradingview.com', // TradingView widget
    ].filter(Boolean),
    'style-src': [
      "'self'",
      "'unsafe-inline'", // Required for styled-components/emotion
      'https://fonts.googleapis.com', // Google Fonts
    ],
    'img-src': [
      "'self'",
      'data:',
      'https:',
      'blob:',
    ],
    'font-src': [
      "'self'",
      'https://fonts.gstatic.com',
    ],
    'connect-src': [
      "'self'",
      // Solana RPC (HTTP and WebSocket)
      'https://api.devnet.solana.com',
      'wss://api.devnet.solana.com', // WebSocket for subscriptions
      'https://api.mainnet-beta.solana.com',
      'wss://api.mainnet-beta.solana.com',
      'https://*.helius-rpc.com',
      'wss://*.helius-rpc.com',
      'https://api.helius.xyz', // Helius REST API (transaction history)
      // Pyth price feeds
      'https://hermes.pyth.network',
      'wss://hermes.pyth.network',
      // Backend API
      'https://api.confidex.exchange',
      isDev ? 'http://localhost:3001' : '',
      isDev ? 'ws://localhost:3001' : '',
      // Wallet adapters
      'https://phantom.app',
      'https://solflare.com',
      // Analytics
      'https://va.vercel-scripts.com',
    ].filter(Boolean),
    'frame-src': [
      "'self'",
      'https://phantom.app',
      'https://solflare.com',
      'https://s3.tradingview.com', // TradingView widget
      'https://*.tradingview.com', // TradingView embeds
      'https://www.tradingview-widget.com', // TradingView widget iframes
    ],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
  };

  // Only add upgrade-insecure-requests in production
  if (!isDev) {
    directives['upgrade-insecure-requests'] = [];
  }

  return Object.entries(directives)
    .map(([key, values]) => {
      if (values.length === 0) return key;
      return `${key} ${values.join(' ')}`;
    })
    .join('; ');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Content Security Policy
          {
            key: 'Content-Security-Policy',
            value: buildCSP(),
          },
          // Prevent clickjacking
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // Prevent MIME type sniffing
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Enable XSS filter
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          // Control referrer information
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // HTTP Strict Transport Security (1 year)
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // Permissions Policy (formerly Feature-Policy)
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self)',
          },
        ],
      },
    ];
  },

  webpack: (config) => {
    // Node.js polyfills
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    // Enable WebAssembly support for ShadowWire
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // Configure WASM file handling
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    return config;
  },
};

module.exports = nextConfig;
