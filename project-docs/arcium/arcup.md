# Arcup Version Manager

The `arcup` version manager enables easy installation and management of the Arcium Networks' tooling suite, consisting of the Arcium CLI binary, the Arx Node Docker image, and the Postgres Docker image (needed to run the Callback Server). With a single command you can install all of the necessary tools, as well as update all of them when there are new releases.

The [Quick Start](#quick-start) section below takes you through basic `arcup` onboarding, however you can find more detailed installation instructions in [installation.md](installation.md). Also, see the [Versioning section below](#inter-component-versioning) for details on how versioning is handled between the different components of the Arcium Network.

## Quick Start

First, delete any local versions of the CLI, or Arx Node (Docker) that you may currently have installed on your machine (if you don't have any currently installed, you can skip this step):

```bash
rm $HOME/.cargo/bin/arcium
docker images | grep "arcium-hq" | awk '{print $1":"$2}' | xargs docker rmi -f
```

Verify that you do not have any versions of the CLI, or Arx Node (Docker) installed on your machine now:

```bash
arcium --version # Should return "No such file or directory"
docker images # Should not show any arcium-related images
```

Next, install `arcup` on your machine by following the steps in [installation.md](installation.md#manual-installation). Then run the `arcup` install command:

```bash
arcup install # Will install the latest releases of the Arcium components
```

Now verify that everything is installed correctly:

```bash
arcium --version # Should show the latest CLI version
arcup version # Shows the currently installed versions of all of the Arcium components
docker images # Should list the images for the Arx Node, and Postgres
```

You can also install older versions using the `install` command (and specifying a version), as well as deleting installed versions with the `delete` command, and switching between already installed versions using the `use` command. See the [Available Commands](#available-commands) section below for full details.

## Inter-Component Versioning

The `arcup` version manager is based on [semver](https://semver.org/) (`MAJOR.MINOR.PATCH`). With `arcup`, the `PATCH` version number need not be in-sync across the different components, however the `MAJOR.MINOR` version number will always be in-sync across all of the Arcium components. As such, `PATCH` changes are always non-breaking with respect to the other Arcium components.

For example, if the current versions are:

* CLI: `0.4.5`
* Arx Node: `0.4.15`

If a breaking change is made to the CLI (e.g. increment to `0.6.3`), the `MINOR` version number of Nodes is also incremented (so both would become `0.6.3`). However, if only a (non-breaking) `PATCH` upgrade is made to tooling, then tooling would increment to `0.6.3` and node would remain unchanged.

## Available Commands

```bash
install  Install the latest (or a specific) version of Arcium components (Arx Node and CLI)
update   Update all Arcium components (Arx Node and CLI) to the latest version
list     List all installed versions
version  Show currently active version
use      Switch to using a specific installed version
delete   Delete a specific version
help     Print this message or the help of the given subcommand(s)
```

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
