# Setup a Testnet Node

## Overview

> Public Testnet on Solana Devnet for stress testing. Real computations; no economic value.

As a testnet operator, you'll set up your own Arx node to participate in the Arcium network. This guide walks you through each step of the process.

First, you'll prepare your environment by installing the necessary tools and generating security keys. Then, you'll get your node registered onchain and configure it to run. Finally, you'll connect to other nodes in a cluster and start doing computations.

By the end, you will:

* Install the Arcium tooling
* Generate required keypairs
* Fund accounts with Devnet SOL
* Initialize onchain node accounts
* Configure for Devnet
* Join or create a testnet cluster
* Deploy your node with Docker

## Prerequisites

Before starting, ensure you have the following installed:

* **Rust**: Install from [rustup.rs](https://rustup.rs/)
* **Solana CLI 2.3.0**: Install from [Solana's documentation](https://docs.solana.com/cli/install-solana-cli-tools)
* **Docker & Docker Compose**: Install from [Docker's documentation](https://docs.docker.com/get-docker/)
* **OpenSSL**: Install from [OpenSSL's documentation](https://www.openssl.org/source/) (usually pre-installed on macOS/Linux)
* **Git**: For cloning repositories and version control

You'll also need:

* A reliable internet connection
* Basic familiarity with command-line tools

**Recommended System Requirements:**

| Resource  | Recommendation                       |
| --------- | ------------------------------------ |
| RAM       | 32GB+                                |
| CPU       | 12+ cores, 2.8GHz+ base              |
| Bandwidth | 1 Gbit/s minimum                     |
| Disk      | Minimal (node is not disk-intensive) |
| GPU       | Not required                         |

**Network Requirements - Open these ports:**

| Port | Protocol  | Purpose                    |
| ---- | --------- | -------------------------- |
| 8001 | TCP & UDP | MPC protocol communication |
| 8002 | TCP & UDP | BLS signature generation   |
| 8012 | TCP & UDP | TD preprocessing           |
| 8013 | TCP       | TD registration            |
| 9091 | TCP       | Prometheus                 |

**Warning:** Arcium doesn't run natively on Windows yet. Use Windows Subsystem for Linux (WSL2) with Ubuntu to follow this guide.

## Step 1: Set Up Your Workspace

Create a dedicated folder for your node setup to keep everything organized:

```bash
mkdir arcium-node-setup
cd arcium-node-setup
```

**Important:** Stay in this directory for all remaining steps. All file paths and Docker commands assume you're working from `arcium-node-setup/`.

You'll also need to know your public IP address for the next steps. Here's a quick way to find it:

```bash
curl https://ipecho.net/plain ; echo
```

## Step 2: Install Arcium Tooling

The Arcium tooling suite includes the CLI and Arx node software. Install it using the automated installer:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
```

This script will:

* Check for all required dependencies
* Install `arcup` (Arcium's version manager)
* Install the latest Arcium CLI
* Install the Arx node software

Verify the installation:

```bash
arcium --version && arcup --version
```

If you prefer manual installation, see the [installation guide](installation.md) for detailed instructions.

## Step 3: Generate Required Keypairs

Your Arx node needs five different keypairs for secure operation. Create these in your `arcium-node-setup` directory:

### 3.1 Node Authority Keypair

This Solana keypair identifies your node and handles onchain operations:

```bash
solana-keygen new --outfile node-keypair.json --no-bip39-passphrase
```

**Note:** The `--no-bip39-passphrase` flag creates a keypair without a passphrase for easier automation.

### 3.2 Callback Authority Keypair

This Solana keypair signs callback computations and must be different from your node keypair for security separation:

```bash
solana-keygen new --outfile callback-kp.json --no-bip39-passphrase
```

### 3.3 Identity Keypair

This keypair handles node-to-node communication and must be in PKCS#8 format:

```bash
openssl genpkey -algorithm Ed25519 -out identity.pem
```

### 3.4 BLS Keypair

This keypair is used for BLS (Boneh-Lynn-Shacham) threshold signatures on MPC computation callbacks. Generate it using the Arcium CLI:

```bash
arcium gen-bls-key bls-keypair.json
```

This creates a 32-byte private key stored as a JSON array format.

### 3.5 X25519 Keypair

This keypair is used for encrypted communication between nodes:

```bash
arcium generate-x25519 -o x25519-keypair.json
```

This creates a 32-byte X25519 private key stored in JSON array format.

**Warning:** Keep these keypairs safe and private. Back them up to a secure location outside your VPS - you'll need them to restore your node if something goes wrong. Never share them with anyone.

## Step 4: Fund Your Accounts

Your node and callback accounts need Devnet SOL for transaction fees.

**Note:** The Devnet faucet has rate limits. Request only 1-2 SOL at a time and wait between requests if needed.

Fund each account and verify the balance:

```bash
# Fund and verify node account
solana airdrop 2 "$(solana address --keypair node-keypair.json)" -u devnet && \
  solana balance "$(solana address --keypair node-keypair.json)" -u devnet

# Fund and verify callback account (needs more SOL for computation fees)
solana airdrop 2 "$(solana address --keypair callback-kp.json)" -u devnet && \
  solana balance "$(solana address --keypair callback-kp.json)" -u devnet
```

**Tip:** If the airdrop doesn't work, use the web faucet at [faucet.solana.com](https://faucet.solana.com/) instead - it's often more reliable than the CLI.

## Step 5: Initialize Node Accounts

Now we'll register your node with the Arcium network by creating its onchain accounts. This step tells the blockchain about your node and its capabilities.

**Note:** Set your Solana CLI to Devnet once so you can avoid passing `--rpc-url <rpc-url>` repeatedly:
`solana config set --url https://api.devnet.solana.com`

For guidance on choosing a reliable endpoint, see the [Devnet RPC Provider Recommendations](#devnet-rpc-provider-recommendations).

Use the `init-arx-accs` command to initialize all required onchain accounts for your node:

```bash
arcium init-arx-accs \
  --keypair-path node-keypair.json \
  --callback-keypair-path callback-kp.json \
  --peer-keypair-path identity.pem \
  --bls-keypair-path bls-keypair.json \
  --x25519-keypair-path x25519-keypair.json \
  --node-offset <your-node-offset> \
  --ip-address <your-public-ip> \
  --rpc-url https://api.devnet.solana.com
```

### Required Parameters:

* `--keypair-path`: Path to your node authority keypair
* `--callback-keypair-path`: Path to your callback authority keypair
* `--peer-keypair-path`: Path to your identity keypair (PEM format)
* `--bls-keypair-path`: Path to your BLS keypair (JSON array format)
* `--x25519-keypair-path`: Path to your X25519 keypair (JSON array format)
* `--node-offset`: Your node's unique ID number on the network. Choose any unique number. If you get an error during setup saying your number is already taken, just pick a different one and try again.
* `--ip-address`: Your node's public IP address
* `--rpc-url`: Solana Devnet RPC endpoint

If successful, you'll see confirmation that your node accounts have been initialized onchain.

## Step 6: Configure Your Node

The configuration file specifies which network to connect to, how to communicate with other nodes, and various operational settings.

Create a `node-config.toml` file in your `arcium-node-setup` directory:

```toml
[node]
offset = <your-node-offset>  # Your node offset from step 5
hardware_claim = 0  # Currently not required to specify, just use 0
starting_epoch = 0
ending_epoch = 9223372036854775807

[network]
address = "0.0.0.0" # Bind to all interfaces for reliability behind NAT/firewalls

[solana]
endpoint_rpc = "<your-rpc-provider-url-here>"  # Replace with your RPC provider URL or use default https://api.devnet.solana.com
endpoint_wss = "<your-rpc-websocket-url-here>"   # Replace with your RPC provider WebSocket URL or use default wss://api.devnet.solana.com
cluster = "Devnet"
commitment.commitment = "confirmed"  # or "processed" or "finalized"
```

**Warning:** All fields are required. Missing fields will crash the node at startup.

**Note:** If your node is behind NAT or a cloud firewall, ensure ports 8001, 8002, 8012, 8013, and 9091 are forwarded and allowed inbound on your public IP. Use your public IP for `--ip-address` during initialization; `network.address` controls the local bind address. Using `"0.0.0.0"` ensures the process binds to all local interfaces while peers connect to the public IP you registered during `init-arx-accs`.

## Step 7: Cluster Operations

Clusters are groups of nodes that collaborate on MPC computations. For background on cluster concepts, see [Clusters Overview](../clusters/overview.md).

Most testnet operators should **join an existing cluster**. Only create your own cluster if you're coordinating a group of nodes.

### Join Existing Cluster

To join an existing cluster, you must first be **proposed by the cluster authority**. Once proposed, accept the invitation:

```bash
arcium join-cluster true \
  --keypair-path node-keypair.json \
  --node-offset <your-node-offset> \
  --cluster-offset <cluster-offset> \
  --rpc-url https://api.devnet.solana.com
```

**Parameters:**

* `true`: Accept the join request (use `false` to reject)
* `--node-offset`: Your node's unique identifier (chosen during node initialization)
* `--cluster-offset`: The cluster's unique identifier (different from node offset - clusters and nodes have separate ID spaces)

**Note:** You cannot join a cluster unless the cluster owner has first proposed you using `propose-join-cluster`.

### Create New Cluster

If you want to create a new cluster and invite other nodes:

**1. Create the Cluster**

```bash
arcium init-cluster \
  --keypair-path node-keypair.json \
  --offset <cluster-offset> \
  --max-nodes <max-nodes> \
  --rpc-url https://api.devnet.solana.com
```

**Parameters:**

* `--offset`: Unique identifier for your cluster (different from your node offset)
* `--max-nodes`: Maximum number of nodes in the cluster

**Optional Parameters:**

* `--mempool-size`: Size of the mempool (`Tiny`, `Small`, `Medium`, `Large`). Defaults to `Tiny`
* `--price-per-cu`: Initial price per compute unit in lamports. Defaults to 1
* `--propose-node`: Automatically propose a node to join after creation

**2. Propose Nodes to Join**

After creating the cluster, you must propose each node that should join. Nodes cannot join without being proposed first:

```bash
arcium propose-join-cluster \
  --keypair-path node-keypair.json \
  --cluster-offset <cluster-offset> \
  --node-offset <node-to-propose-offset> \
  --rpc-url https://api.devnet.solana.com
```

**Parameters:**

* `--cluster-offset`: Your cluster's offset
* `--node-offset`: The offset of the node you're inviting

**Note:** You can also propose a node inline when creating the cluster using `--propose-node <node-offset>`

**3. Wait for Nodes to Accept**

Once proposed, each node must accept the invitation using `join-cluster true` (see Join section above).

### Submit Aggregated BLS Key (Required After Cluster is Full)

**Note:** The command will verify that all cluster slots are filled before submitting. If nodes are still pending, it will fail with an error.

Once all nodes have joined the cluster, **one node** must aggregate and submit the combined BLS public key. This enables threshold BLS signatures for computation callbacks:

```bash
arcium submit-aggregated-bls-key \
  --keypair-path node-keypair.json \
  --cluster-offset <cluster-offset> \
  --node-offset <your-node-offset> \
  --rpc-url https://api.devnet.solana.com
```

**Parameters:**

* `--keypair-path`: Your node authority keypair (must be a node in the cluster)
* `--cluster-offset`: The cluster's offset
* `--node-offset`: Your node's offset within the cluster

**Note:** Only one node needs to run this command. The CLI will automatically fetch all node BLS public keys from the cluster and aggregate them.

### Test Cluster (After Full Setup)

Once all nodes have joined and the aggregated BLS key is submitted, verify the cluster can perform computations:

```bash
arcium test-cluster \
  --cluster-offset <cluster-offset> \
  --keypair-path node-keypair.json \
  --rpc-url https://api.devnet.solana.com
```

## Step 8: Deploy Your Node

Before running Docker, prepare your environment and verify you have all required files:

```bash
mkdir -p arx-node-logs
ls node-keypair.json callback-kp.json identity.pem bls-keypair.json x25519-keypair.json node-config.toml
```

Now start the container:

```bash
docker run -d \
  --name arx-node \
  -e NODE_IDENTITY_FILE=/usr/arx-node/node-keys/node_identity.pem \
  -e NODE_KEYPAIR_FILE=/usr/arx-node/node-keys/node_keypair.json \
  -e CALLBACK_AUTHORITY_KEYPAIR_FILE=/usr/arx-node/node-keys/callback_authority_keypair.json \
  -e BLS_PRIVATE_KEY_FILE=/usr/arx-node/node-keys/bls_keypair.json \
  -e X25519_PRIVATE_KEY_FILE=/usr/arx-node/node-keys/x25519_keypair.json \
  -e ARX_METRICS_HOST=0.0.0.0 \
  -e ARX_METRICS_PORT=9091 \
  -v "$(pwd)/node-config.toml:/usr/arx-node/arx/node_config.toml" \
  -v "$(pwd)/node-keypair.json:/usr/arx-node/node-keys/node_keypair.json:ro" \
  -v "$(pwd)/callback-kp.json:/usr/arx-node/node-keys/callback_authority_keypair.json:ro" \
  -v "$(pwd)/identity.pem:/usr/arx-node/node-keys/node_identity.pem:ro" \
  -v "$(pwd)/bls-keypair.json:/usr/arx-node/node-keys/bls_keypair.json:ro" \
  -v "$(pwd)/x25519-keypair.json:/usr/arx-node/node-keys/x25519_keypair.json:ro" \
  -v "$(pwd)/arx-node-logs:/usr/arx-node/logs" \
  -v "$(pwd)/private-shares:/usr/arx-node/private-shares" \
  -v "$(pwd)/public-inputs:/usr/arx-node/public-inputs" \
  -p 8001:8001 \
  -p 8002:8002 \
  -p 8012:8012 \
  -p 8013:8013 \
  -p 9091:9091 \
  arcium/arx-node
```

**Warning:** Ensure ports 8001, 8002, 8012, 8013, and 9091 are open in your OS and cloud provider firewalls. The metrics endpoint (9091) has no authentication - restrict access to trusted networks only.

## Step 9: Verify Node Operation

Check that your node is running correctly:

### Check Node Status

```bash
arcium arx-info <your-node-offset> --rpc-url https://api.devnet.solana.com
```

### Check if Node is Active

```bash
arcium arx-active <your-node-offset> --rpc-url https://api.devnet.solana.com
```

### Metrics & Health

The node exposes Prometheus-compatible metrics on port 9091:

| Endpoint       | Description                 |
| -------------- | --------------------------- |
| `GET /metrics` | Prometheus-format metrics   |
| `GET /health`  | Health check (returns "OK") |

Verify:

```bash
curl -s http://localhost:9091/metrics | grep arx_
curl -s http://localhost:9091/health
```

Scrape with [Prometheus](https://prometheus.io/) and visualize with [Grafana](https://grafana.com/):

```yaml
# prometheus.yml snippet
scrape_configs:
  - job_name: 'arx-node'
    static_configs:
      - targets: ['localhost:9091']
```

### Monitor Logs

If using Docker:

```bash
docker logs -f arx-node
```

### Extract Internal Logs

If you need detailed logs for debugging:

```bash
docker cp arx-node:/usr/arx-node/logs ./node-logs
ls ./node-logs/  # Shows arx_log_<datetime>_<offset>.log
```

## Devnet RPC Provider Recommendations

For better reliability, consider using dedicated RPC providers instead of the default public endpoints. **Free tiers are sufficient for testnet - paid plans are NOT required.**

**Recommended providers:**

* [Helius](https://helius.xyz) - free tier works perfectly for testnet
* [QuickNode](https://quicknode.com) - free tier works perfectly for testnet

## Troubleshooting

### Node fails with 'missing environment variable'

All 5 environment variables are required. Verify your Docker command includes:

* `NODE_KEYPAIR_FILE`
* `CALLBACK_AUTHORITY_KEYPAIR_FILE`
* `NODE_IDENTITY_FILE`
* `BLS_PRIVATE_KEY_FILE`
* `X25519_PRIVATE_KEY_FILE`

### Node fails with 'X25519 key invalid'

Regenerate the X25519 keypair:

```bash
arcium generate-x25519 -o x25519-keypair.json
```

### Node Not Starting

* Verify all 5 keypair files exist and are readable
* Check that `node-config.toml` is valid TOML with all required fields
* Ensure your IP address is accessible from the internet

### Node can't reach peers

1. Verify firewall allows inbound on ports: 8001, 8002, 8012, 8013, and 9091 (all TCP)
2. Check RPC endpoint is responsive
3. Verify node is active: `arcium arx-active <offset>`

### Account Initialization Failed

* Verify you have sufficient SOL for transaction fees
* Check that your RPC endpoint is working
* Ensure node offset is unique (try a different number)

### Cannot Join Cluster

* Verify you've been invited by the cluster authority
* Check that cluster has available slots
* Ensure your node is properly initialized

### BLS aggregation failing

All cluster nodes need valid BLS keys. After all nodes join:

```bash
arcium submit-aggregated-bls-key \
  --keypair-path node-keypair.json \
  --cluster-offset <cluster-offset> \
  --node-offset <your-node-offset> \
  --rpc-url https://api.devnet.solana.com
```

### Callback authority out of funds

```bash
solana airdrop 2 "$(solana address -k callback-kp.json)" -u devnet
```

### Docker Issues

* Verify Docker is running
* Check file permissions on mounted volumes
* Ensure ports 8001, 8002, 8012, 8013, and 9091 are not already in use

**Tip:** Need more help? Join the [Arcium Discord](https://discord.gg/arcium) for community support, or review the [installation troubleshooting guide](installation.md#issues).

## What's Next

Once your Testnet node is running successfully:

* **Join the Community**: Connect with other node operators on [Discord](https://discord.gg/arcium)
* **Stay Updated**: Keep your Arcium tooling updated with `arcup install`
* **Learn More**: Read the [Arcium Network Overview](intro-to-arcium.md) or [Installation Guide](installation.md)

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
