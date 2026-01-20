# Intro to Arcium

Arcium is a decentralized private computation network that enables secure processing of encrypted data through Multi-Party Computation (MPC). It solves a fundamental problem in Web3: how to process sensitive data while maintaining privacy. Traditionally, computation requires data to be decrypted, making it vulnerable to attacks and exposing private information. Arcium changes this by allowing computations to run on fully encrypted data.

## What Arcium Enables

As a Solana developer, Arcium gives you the ability to:

1. **Build Privacy-Preserving Applications**: Add privacy to your applications without adopting a new blockchain, programming language, or workflow. Arcium maintains full composability within familiar ecosystems.
2. **Use Familiar Tooling**: Leverage the Arcis framework, which extends Solana's Anchor tooling. Built in Rust, it allows you to add privacy simply by marking functions as confidential—no cryptography knowledge required.
3. **Process Sensitive Data**: Run computations on encrypted data without ever decrypting it. This means sensitive information like user balances, trade orders, or personal data can be processed securely.

## How It Works

Your application (MXE) works with encrypted data in three simple steps:

1. Client encrypts data and sends it to your MXE program
2. Your program submits the computation to Arcium's network of MPC nodes
3. Nodes process the data while keeping it encrypted, then return the results

The entire process happens onchain through Solana, with each step verified and coordinated by Arcium's programs. For larger computations, an optional callback server handles results that don't fit in a single transaction.

## Common Use Cases

1. **Confidential DeFi**: Build dark pools, aka private order books, where trade sizes and prices remain hidden, enabling truly permissionless confidential trading without front-running or market manipulation.
2. **Secure AI**: Enable AI model inference and training on sensitive data while keeping the data encrypted.
3. **Confidential Gaming**: Build hidden information games where player moves and state remain private until revealed (e.g., card games, strategy games, auctions).

## Getting Started

Arcium provides a familiar development experience for Solana developers:

* Use the `arcium` CLI (a wrapper over `anchor` CLI) to build Solana programs with Arcium
* Write confidential instructions in Rust using the Arcis framework
* Integrate with your Solana programs using the TypeScript client library

Follow these steps to get started:

1. [Install Arcium](installation.md) - Set up the development environment and tools
2. [Hello World](hello-world.md) - Create your first confidential instruction
3. [Computation Lifecycle](computation-lifecycle.md) - Understand how confidential computations work
4. [TypeScript SDK Reference](https://ts.arcium.com/api) - Complete API documentation for TypeScript client libraries

The network is currently in Public Testnet. Join our [Discord](https://discord.com/invite/arcium) to join our community and start building.

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
