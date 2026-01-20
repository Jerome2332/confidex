# Callback Server

When an encrypted instruction produces output that's too large to fit in a single Solana transaction (which has a size limit), you'll need to implement a callback server. This is a simple HTTP server that you develop and host yourself, which acts as an intermediary to receive large computation results from the MPC nodes and process them according to your application's needs.

For example, if your encrypted instruction produces a large output (say 10KB), the MPC nodes will first pack as much data as possible into the normal callback transaction (~1KB), and send the remaining data (in this case ~9KB) to your callback server. This allows you to handle arbitrarily large outputs while still maintaining the efficiency of direct onchain callbacks when possible.

The callback server provides a simple HTTP endpoint that receives the computation output, verifies its authenticity using signatures from the MPC nodes, and processes the data according to your needs. This allows you to handle arbitrarily large computation results while maintaining the security guarantees of the Arcium protocol. Onchain, the callback server must also call the `finalize` transaction for the computation, where the Arcium program verifies that the data submitted by the callback server matches the data computed by the MPC nodes by comparing their hashes.

## API Interface

### POST /callback

Receives a raw byte object with the following structure:

`mempool_id|comp_def_offset|tx_sig|data_sig|pub_key|data`

* `mempool_id`: u16 - Mempool identifier
* `comp_def_offset`: u32 - Identifier for the given computation definition in the MXE program
* `tx_sig`: [u8; 64] - The transaction signature of the callback transaction
* `data_sig`: [u8; 64] - The signature of the data, signed by one of the node's private keys
* `pub_key`: [u8; 32] - The public key of the node that signed the data
* `data`: Vec<u8> - The actual computation output to be processed

The server will then verify the signatures, and if they are valid, it will process the data.

The most common use case is to perform any necessary processing and submit the data back to the chain.

The server will then return a 200 OK response.

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
