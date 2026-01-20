# Input/Output

> Working with Enc types for encrypted inputs and outputs in Arcis circuits

Inputs and outputs in confidential instructions are handled the same way. The Arcium network does not mutate any state itself. Both can be encrypted or plaintext.

Encrypted data is passed as an `Enc<Owner, T>` generic type. See [Types](types.md#encryption-types) for the full reference on `Enc<Shared, T>` vs `Enc<Mxe, T>`.

## Data Visibility

Parameters and return values have different visibility levels during MPC execution:

| Type                            | Who Sees Plaintext              |
| ------------------------------- | ------------------------------- |
| Plaintext (`u64`, `bool`, etc.) | All ARX nodes                   |
| `Enc<Shared, T>`                | Client + MXE (after decryption) |
| `Enc<Mxe, T>`                   | MXE only                        |

**Warning:** Plaintext parameters are visible to all ARX nodes during computation. Use `Enc<Shared, T>` for sensitive user data.

### Return Value Requirements

Values returned from an `#[instruction]` must be in a form that can leave the MPC circuit:

* **Encrypted:** Call `.from_arcis()` to produce `Enc<Owner, T>`. The ciphertext is public bytes; the plaintext remains protected.
* **Revealed:** Call `.reveal()` to produce plaintext. The value becomes visible to everyone.

Secret-shared values (intermediate results from `.to_arcis()`) cannot be returned directly—they exist only within the MPC computation.

## Example

```rust
use arcis::*;

#[encrypted]
mod order_book {
    use arcis::*;

    const ORDER_BOOK_SIZE: usize = 8;

    #[derive(Copy, Clone)]
    pub struct Order {
        size: u64,
        bid: bool,
        owner: u128,
    }

    #[derive(Copy, Clone)]
    pub struct OrderBook {
        orders: [Order; ORDER_BOOK_SIZE],
    }

    #[instruction]
    pub fn add_order(
        order_ctxt: Enc<Shared, Order>,
        ob_ctxt: Enc<Mxe, OrderBook>,
    ) -> Enc<Mxe, OrderBook> {
        let order = order_ctxt.to_arcis();
        let mut ob = ob_ctxt.to_arcis();
        let mut found = false;
        for i in 0..ORDER_BOOK_SIZE {
            let overwrite = ob.orders[i].size == 0 && !found;
            if overwrite {
                ob.orders[i] = order;
            }
            found = overwrite || found;
        }
        ob_ctxt.owner.from_arcis(ob)
    }
}
```

This example demonstrates how to pass inputs into confidential instructions, compute on them, and return outputs. The goal is to add an order to an existing order book.

In this example, `order_ctxt: Enc<Shared, Order>` contains data encrypted with a shared secret between the client and MXE—both can decrypt it. In contrast, `ob_ctxt: Enc<Mxe, OrderBook>` is encrypted exclusively for the MXE, so only the MXE nodes (acting together) can decrypt it. This pattern is useful for storing protocol state that users shouldn't access directly.

**Why use Mxe?** If `ob_ctxt` were `Enc<Shared, OrderBook>`, any user could decrypt the entire order book and see everyone else's orders. By using `Enc<Mxe, OrderBook>`, only the MXE cluster can access the aggregate state—individual users can only see their own inputs and the revealed outputs.

To use the parameters `order_ctxt` and `ob_ctxt` for computation, we need to convert them to corresponding secret shares for the nodes to compute in MPC. This is done by calling the `to_arcis` function on any `Enc` generic parameter. This does not reveal the plaintext data underneath to the nodes during the process.

The order parameter is consumed after the confidential instruction has been processed. To output the new order book, convert it back using `from_arcis` on the `ob_ctxt.owner` field (the party that encrypted the data) to get the new `Enc<Owner, T>` type, and return it.

For more details on how to invoke these encrypted instructions from your Solana program, see the [program documentation](../program/program-overview.md).

## What's Next?

| Resource | Description |
|----------|-------------|
| [Operations](operations.md) | Complete operation support matrix for expressions, iterators, and generics |
| [Types](types.md) | Full reference for `Enc<Owner, T>` and other encryption types |
| [Sealing](../js-client-library/sealing.md) | Re-encrypting data for different recipients |

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
