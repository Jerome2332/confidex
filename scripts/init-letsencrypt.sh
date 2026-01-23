#!/bin/bash
# Confidex SSL Certificate Setup Script
# Automates Let's Encrypt certificate generation using certbot

set -e

# Configuration
DOMAINS=${DOMAINS:-"app.confidex.exchange api.confidex.exchange"}
EMAIL=${EMAIL:-"admin@confidex.exchange"}
STAGING=${STAGING:-0}  # Set to 1 for testing (avoid rate limits)
DATA_PATH="./nginx/ssl"
NGINX_CONF="./nginx/conf.d"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Confidex SSL Certificate Setup${NC}"
echo "================================"
echo ""

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: docker-compose or docker is not installed${NC}"
    exit 1
fi

# Use docker compose v2 if available
COMPOSE_CMD="docker-compose"
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
fi

# Create required directories
echo -e "${YELLOW}Creating SSL directories...${NC}"
mkdir -p "$DATA_PATH/certbot/conf"
mkdir -p "$DATA_PATH/certbot/www"

# Check for existing certificates
if [ -d "$DATA_PATH/certbot/conf/live" ]; then
    echo -e "${YELLOW}Existing certificates found.${NC}"
    read -p "Do you want to renew/replace them? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Exiting without changes."
        exit 0
    fi
fi

# Generate dummy certificate for nginx startup
echo -e "${YELLOW}Creating dummy certificate for nginx startup...${NC}"
for domain in $DOMAINS; do
    domain_path="$DATA_PATH/certbot/conf/live/$domain"
    mkdir -p "$domain_path"

    if [ ! -f "$domain_path/privkey.pem" ]; then
        openssl req -x509 -nodes -newkey rsa:4096 -days 1 \
            -keyout "$domain_path/privkey.pem" \
            -out "$domain_path/fullchain.pem" \
            -subj "/CN=$domain" 2>/dev/null
        echo "  Created dummy cert for $domain"
    fi
done

# Generate dhparam if not exists
if [ ! -f "$DATA_PATH/dhparam.pem" ]; then
    echo -e "${YELLOW}Generating DH parameters (this may take a while)...${NC}"
    openssl dhparam -out "$DATA_PATH/dhparam.pem" 2048
fi

# Create SSL configuration snippet
echo -e "${YELLOW}Creating SSL configuration...${NC}"
cat > "$DATA_PATH/ssl-params.conf" << 'EOF'
# SSL Parameters - Modern configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;

# SSL session
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:50m;
ssl_session_tickets off;

# OCSP Stapling
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 5s;

# DH parameters
ssl_dhparam /etc/nginx/ssl/dhparam.pem;
EOF

# Start nginx with dummy certs
echo -e "${YELLOW}Starting nginx...${NC}"
$COMPOSE_CMD up -d nginx

# Wait for nginx to be ready
sleep 5

# Request Let's Encrypt certificates
echo -e "${YELLOW}Requesting Let's Encrypt certificates...${NC}"

# Set staging flag if testing
staging_arg=""
if [ "$STAGING" = "1" ]; then
    staging_arg="--staging"
    echo -e "${YELLOW}Using staging environment (certificates won't be valid)${NC}"
fi

# Request certificates for each domain
for domain in $DOMAINS; do
    echo -e "${GREEN}Requesting certificate for $domain...${NC}"

    $COMPOSE_CMD run --rm certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        $staging_arg \
        -d "$domain"
done

# Reload nginx with real certificates
echo -e "${YELLOW}Reloading nginx with new certificates...${NC}"
$COMPOSE_CMD exec nginx nginx -s reload

echo ""
echo -e "${GREEN}SSL setup complete!${NC}"
echo ""
echo "Your certificates are located in: $DATA_PATH/certbot/conf/live/"
echo ""
echo "To set up auto-renewal, add this cron job:"
echo "  0 0 * * * cd $(pwd) && $COMPOSE_CMD run --rm certbot renew && $COMPOSE_CMD exec nginx nginx -s reload"
echo ""
