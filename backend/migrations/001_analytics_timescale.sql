-- ============================================================================
-- TimescaleDB Analytics Schema for Confidex DEX
-- ============================================================================
--
-- PRIVACY RULES:
-- - NEVER store encrypted fields (encrypted_amount, encrypted_price, etc.)
-- - Only store publicly visible on-chain data
-- - All amounts/prices in these tables are PUBLIC aggregate metrics
-- ============================================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================================
-- Exchange-wide snapshots (global KPIs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS exchange_snapshots (
    time              TIMESTAMPTZ NOT NULL,
    pair_count        BIGINT NOT NULL DEFAULT 0,
    order_count       BIGINT NOT NULL DEFAULT 0,
    position_count    BIGINT NOT NULL DEFAULT 0,
    market_count      BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (time)
);

-- Convert to hypertable with 1 hour chunks
SELECT create_hypertable('exchange_snapshots', 'time',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- ============================================================================
-- Order events (PUBLIC data only)
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_events (
    time              TIMESTAMPTZ NOT NULL,
    event_type        TEXT NOT NULL,        -- 'placed', 'cancelled', 'matched', 'filled'
    signature         TEXT NOT NULL,        -- Transaction signature
    order_id          TEXT NOT NULL,        -- Order PDA
    maker             TEXT NOT NULL,        -- Maker wallet
    pair              TEXT NOT NULL,        -- Trading pair PDA
    side              TEXT NOT NULL,        -- 'buy' or 'sell'
    slot              BIGINT,
    -- NO: encrypted_amount, encrypted_price, fill_amount
    PRIMARY KEY (time, signature)
);

SELECT create_hypertable('order_events', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_order_events_pair ON order_events (pair, time DESC);
CREATE INDEX IF NOT EXISTS idx_order_events_maker ON order_events (maker, time DESC);
CREATE INDEX IF NOT EXISTS idx_order_events_type ON order_events (event_type, time DESC);

-- ============================================================================
-- Trade events (PUBLIC data only)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_events (
    time              TIMESTAMPTZ NOT NULL,
    signature         TEXT NOT NULL,        -- Transaction signature
    buy_order_id      TEXT NOT NULL,
    sell_order_id     TEXT NOT NULL,
    buyer             TEXT NOT NULL,
    seller            TEXT NOT NULL,
    pair              TEXT NOT NULL,
    slot              BIGINT,
    -- NO: fill_amount, price, encrypted fields
    PRIMARY KEY (time, signature)
);

SELECT create_hypertable('trade_events', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_trade_events_pair ON trade_events (pair, time DESC);
CREATE INDEX IF NOT EXISTS idx_trade_events_buyer ON trade_events (buyer, time DESC);
CREATE INDEX IF NOT EXISTS idx_trade_events_seller ON trade_events (seller, time DESC);

-- ============================================================================
-- Perpetual market snapshots (PUBLIC aggregate OI)
-- ============================================================================

CREATE TABLE IF NOT EXISTS perp_market_snapshots (
    time                      TIMESTAMPTZ NOT NULL,
    market_address            TEXT NOT NULL,
    total_long_oi             BIGINT NOT NULL DEFAULT 0,  -- PUBLIC aggregate
    total_short_oi            BIGINT NOT NULL DEFAULT 0,  -- PUBLIC aggregate
    position_count            INTEGER NOT NULL DEFAULT 0,
    long_position_count       INTEGER NOT NULL DEFAULT 0,
    short_position_count      INTEGER NOT NULL DEFAULT 0,
    current_funding_rate_bps  SMALLINT,                   -- PUBLIC funding rate
    mark_price_usd            BIGINT,                     -- PUBLIC oracle price (6 decimals)
    PRIMARY KEY (time, market_address)
);

SELECT create_hypertable('perp_market_snapshots', 'time',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_perp_snapshots_market ON perp_market_snapshots (market_address, time DESC);

-- ============================================================================
-- Liquidation events (PUBLIC data only)
-- ============================================================================

CREATE TABLE IF NOT EXISTS liquidation_events (
    time              TIMESTAMPTZ NOT NULL,
    signature         TEXT,                 -- Transaction signature (NULL if failed)
    position_id       TEXT NOT NULL,        -- Position PDA
    market            TEXT NOT NULL,        -- Market PDA
    side              TEXT NOT NULL,        -- 'long' or 'short'
    owner             TEXT NOT NULL,        -- Position owner
    liquidator        TEXT,                 -- Liquidator wallet
    event_type        TEXT NOT NULL,        -- 'detected', 'executed', 'failed'
    slot              BIGINT,
    -- NO: position size, collateral, PnL (all encrypted)
    PRIMARY KEY (time, position_id, event_type)
);

SELECT create_hypertable('liquidation_events', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_liquidation_events_market ON liquidation_events (market, time DESC);
CREATE INDEX IF NOT EXISTS idx_liquidation_events_owner ON liquidation_events (owner, time DESC);
CREATE INDEX IF NOT EXISTS idx_liquidation_events_type ON liquidation_events (event_type, time DESC);

-- ============================================================================
-- Funding rate history
-- ============================================================================

CREATE TABLE IF NOT EXISTS funding_rate_history (
    time                      TIMESTAMPTZ NOT NULL,
    market_address            TEXT NOT NULL,
    funding_rate_bps          SMALLINT NOT NULL,          -- Funding rate in basis points
    long_oi                   BIGINT,                     -- PUBLIC aggregate at time of funding
    short_oi                  BIGINT,                     -- PUBLIC aggregate at time of funding
    PRIMARY KEY (time, market_address)
);

SELECT create_hypertable('funding_rate_history', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- ============================================================================
-- Continuous aggregates
-- ============================================================================

-- Hourly trading activity by pair
CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_trading_activity
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    pair,
    COUNT(*) FILTER (WHERE event_type = 'placed') AS orders_placed,
    COUNT(*) FILTER (WHERE event_type = 'matched') AS orders_matched,
    COUNT(*) FILTER (WHERE event_type = 'cancelled') AS orders_cancelled,
    COUNT(DISTINCT maker) AS unique_traders
FROM order_events
GROUP BY bucket, pair
WITH NO DATA;

-- Refresh policy: update every 5 minutes, keep last 7 days materialized
SELECT add_continuous_aggregate_policy('hourly_trading_activity',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE
);

-- Daily liquidation stats by market
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_liquidation_stats
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    market,
    COUNT(*) FILTER (WHERE event_type = 'detected') AS detected,
    COUNT(*) FILTER (WHERE event_type = 'executed') AS executed,
    COUNT(*) FILTER (WHERE event_type = 'failed') AS failed,
    COUNT(DISTINCT owner) AS unique_positions_liquidated
FROM liquidation_events
GROUP BY bucket, market
WITH NO DATA;

SELECT add_continuous_aggregate_policy('daily_liquidation_stats',
    start_offset => INTERVAL '30 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- ============================================================================
-- Retention and compression policies
-- ============================================================================

-- Retention: Keep detailed data for limited time, aggregates longer
SELECT add_retention_policy('order_events', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('trade_events', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('liquidation_events', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('exchange_snapshots', INTERVAL '365 days', if_not_exists => TRUE);
SELECT add_retention_policy('perp_market_snapshots', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('funding_rate_history', INTERVAL '365 days', if_not_exists => TRUE);

-- Compression: Compress old data to save storage
SELECT add_compression_policy('exchange_snapshots', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('perp_market_snapshots', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('order_events', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('trade_events', INTERVAL '7 days', if_not_exists => TRUE);

-- ============================================================================
-- Helper functions
-- ============================================================================

-- Get latest exchange stats
CREATE OR REPLACE FUNCTION get_latest_exchange_stats()
RETURNS TABLE (
    pair_count BIGINT,
    order_count BIGINT,
    position_count BIGINT,
    market_count BIGINT,
    snapshot_time TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        es.pair_count,
        es.order_count,
        es.position_count,
        es.market_count,
        es.time as snapshot_time
    FROM exchange_snapshots es
    ORDER BY es.time DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Get trading activity for a pair
CREATE OR REPLACE FUNCTION get_pair_activity(
    p_pair TEXT,
    p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    orders_placed BIGINT,
    orders_matched BIGINT,
    orders_cancelled BIGINT,
    unique_traders BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE event_type = 'placed'),
        COUNT(*) FILTER (WHERE event_type = 'matched'),
        COUNT(*) FILTER (WHERE event_type = 'cancelled'),
        COUNT(DISTINCT maker)
    FROM order_events
    WHERE pair = p_pair
      AND time > NOW() - (p_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- Get liquidation count for time period
CREATE OR REPLACE FUNCTION get_liquidation_count(
    p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    detected BIGINT,
    executed BIGINT,
    failed BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE event_type = 'detected'),
        COUNT(*) FILTER (WHERE event_type = 'executed'),
        COUNT(*) FILTER (WHERE event_type = 'failed')
    FROM liquidation_events
    WHERE time > NOW() - (p_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql;
