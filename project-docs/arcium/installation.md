# Installation

## Quick Install (Recommended)

On Mac and Linux, run this single command to install Arcium:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
```

`arcup` is a tool for managing versioning of the Arcium tooling (including the CLI and Arx Node). More info on it can be found in [arcup.md](arcup.md).

This script will:

* Check for all required dependencies
* Install Linux build dependencies automatically (if needed)
* Download and install `arcup` for your platform
* Install the latest Arcium CLI (command-line interface for interacting with the Arcium network and managing computations)
* Install the Arx Node (the core node software that performs encrypted computations in the network)

### Prerequisites

Before running the installation script, make sure you have these dependencies installed:

* **Rust**: Install from [rustup](https://www.rust-lang.org/tools/install)
* **Solana CLI 2.3.0**: Install from [Solana docs](https://docs.solana.com/cli/install-solana-cli-tools), then run `solana-keygen new`
* **Yarn**: Install from [Yarn](https://yarnpkg.com/getting-started/install)
* **Anchor 0.32.1**: Install from [Anchor](https://www.anchor-lang.com/docs/installation)
* **Docker & Docker Compose**: Install Docker from [Docker docs](https://docs.docker.com/engine/install/) and Docker Compose from [Docker Compose docs](https://docs.docker.com/compose/install/)

The installation script will check for all these dependencies and provide clear instructions if any are missing.

## Manual Installation

If you prefer to install manually, you can still use the traditional method. arcup is a tool for managing versioning of the arcium tooling (including the CLI and Arx Node). More info on it can be found in [arcup.md](arcup.md).

Install `arcup`. We currently support 4 pre-built targets, listed below. We do not support Windows at the moment.

* `aarch64_linux`
* `x86_64_linux`
* `aarch64_macos`
* `x86_64_macos`

You can install it by replacing `<YOUR_TARGET>` with the target you want to install, and running the following command:

### Arch Linux
```bash
TARGET=aarch64_linux && curl "https://bin.arcium.com/download/arcup_${TARGET}_0.6.3" -o ~/.cargo/bin/arcup && chmod +x ~/.cargo/bin/arcup
```

### x86 Linux
```bash
TARGET=x86_64_linux && curl "https://bin.arcium.com/download/arcup_${TARGET}_0.6.3" -o ~/.cargo/bin/arcup && chmod +x ~/.cargo/bin/arcup
```

### Apple Silicon
```bash
TARGET=aarch64_macos && curl "https://bin.arcium.com/download/arcup_${TARGET}_0.6.3" -o ~/.cargo/bin/arcup && chmod +x ~/.cargo/bin/arcup
```

### Intel Mac
```bash
TARGET=x86_64_macos && curl "https://bin.arcium.com/download/arcup_${TARGET}_0.6.3" -o ~/.cargo/bin/arcup && chmod +x ~/.cargo/bin/arcup
```

Install the latest version of the CLI using `arcup`:

```bash
arcup install
```

Verify the installation:

```bash
arcium --version
```

## Issues

Installation might fail due to a variety of reasons. This section contains a list of the most common issues and their solutions, taken from Anchor's installation guide.

### Platform-Specific Issues

**Windows Users:** Arcium is not currently supported on Windows. We recommend using Windows Subsystem for Linux (WSL2) with Ubuntu for the best experience.

**Linux Systems:** You may need additional dependencies. On Ubuntu/Debian:

```bash
sudo apt-get update && sudo apt-get upgrade && sudo apt-get install -y pkg-config build-essential libudev-dev libssl-dev
```

### Incorrect `$PATH`

Rust binaries, including `arcup` and `arcium`, are installed to the `~/.cargo/bin` directory. Since this directory is required to be in the `PATH` environment variable, Rust installation tries to set it up automatically, but it might fail to do so on some platforms.

To verify that the `PATH` environment variable was set up correctly, run:

```shell
which arcium
```

The output should look like (with your username):

```
/home/user/.cargo/bin/arcium
```

**Shell-Specific PATH Issues:**

If `which arcium` returns nothing, add the cargo bin directory to your PATH:

* **Bash/Zsh:** Add to `~/.bashrc` or `~/.zshrc`:

  ```bash
  export PATH="$HOME/.cargo/bin:$PATH"
  ```
* **Fish:** Add to `~/.config/fish/config.fish`:

  ```bash
  set -gx PATH $HOME/.cargo/bin $PATH
  ```

After editing, restart your terminal or run `source ~/.bashrc` (or equivalent for your shell).

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
