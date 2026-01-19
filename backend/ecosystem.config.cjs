/**
 * PM2 Ecosystem Configuration
 *
 * Production process manager for the Confidex backend + crank service.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs          # Start all services
 *   pm2 start ecosystem.config.cjs --only crank  # Start just crank
 *   pm2 logs crank                          # View crank logs
 *   pm2 monit                               # Monitor all processes
 *   pm2 restart crank                       # Restart crank
 *   pm2 stop all                            # Stop everything
 *   pm2 delete all                          # Remove from PM2
 *
 * Auto-restart on boot:
 *   pm2 startup                             # Generate startup script
 *   pm2 save                                # Save current process list
 */

module.exports = {
  apps: [
    {
      name: 'confidex-backend',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,

        // Crank configuration
        CRANK_ENABLED: 'true',
        CRANK_POLLING_INTERVAL_MS: '5000',
        CRANK_USE_ASYNC_MPC: 'true',  // Use real async MPC in production
        CRANK_MAX_CONCURRENT_MATCHES: '5',
        CRANK_WALLET_PATH: './keys/crank-wallet.json',
        CRANK_MIN_SOL_BALANCE: '0.1',

        // Circuit breaker
        CRANK_ERROR_THRESHOLD: '10',
        CRANK_PAUSE_DURATION_MS: '60000',
      },

      // Logging
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Restart policy
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
