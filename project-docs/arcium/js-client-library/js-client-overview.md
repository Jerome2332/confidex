# JavaScript Client Library Overview

## Overview

Arcium offers two TS libraries, which provide tools and utilities for interacting with Arcium and the MXEs (MPC eXecution Environments) deployed on it.

**Client library `@arcium-hq/client`:**

* Handle secret sharing and encryption of inputs
* Submit confidential transactions
* Manage callbacks for computation results

**Reader library `@arcium-hq/reader`:**

* Read MXE data
* View computations for a given MXE

Generally speaking, the client library is used to build & invoke computations on MXEs and then track their outputs, while the reader library is more so to track the overall network. To get a better idea of its place in the general architecture, we highly recommend taking a look at the [computation lifecycle](../computation-lifecycle.md).

## Installation

### Client library

```bash
# npm
npm install @arcium-hq/client

# yarn
yarn add @arcium-hq/client

# pnpm
pnpm add @arcium-hq/client
```

### Reader library

```bash
# npm
npm install @arcium-hq/reader

# yarn
yarn add @arcium-hq/reader

# pnpm
pnpm add @arcium-hq/reader
```

## API Reference

For complete TypeScript SDK documentation and API reference for the client and reader libraries, visit: [ts.arcium.com/api](https://ts.arcium.com/api)

## Using the client

Prefer a more step-by-step approach? Get started with learning [how to encrypt inputs for confidential transactions](encryption.md).

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
