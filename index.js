const express = require('express');
const bodyParser = require('body-parser');
const { pool, withTransaction } = require('./db');
require('dotenv').config();

const app = express();
const port = process.env.API_PORT || 8080;

app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP' });
});

// GET /api/products/{id}
app.get('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/products/reset
app.post('/api/products/reset', async (req, res) => {
    try {
        await withTransaction(async (client) => {
            // Reset products to initial state
            await client.query('UPDATE products SET stock = 100, version = 1 WHERE id = 1');
            await client.query('UPDATE products SET stock = 50, version = 1 WHERE id = 2');
            // Clear orders
            await client.query('DELETE FROM orders');
        });
        res.status(200).json({ message: 'Product inventory reset successfully.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/orders/pessimistic
app.post('/api/orders/pessimistic', async (req, res) => {
    const { productId, quantity, userId } = req.body;

    try {
        const result = await withTransaction(async (client) => {
            // 1. Acquire row-level lock
            const productResult = await client.query(
                'SELECT * FROM products WHERE id = $1 FOR UPDATE',
                [productId]
            );

            if (productResult.rows.length === 0) {
                throw { status: 404, message: 'Product not found' };
            }

            const product = productResult.rows[0];

            // 2. Check stock
            if (product.stock < quantity) {
                throw { status: 400, message: 'Insufficient stock' };
            }

            // 3. Decrement stock
            const updateResult = await client.query(
                'UPDATE products SET stock = stock - $1 WHERE id = $2 RETURNING stock',
                [quantity, productId]
            );

            // 4. Create order record
            const orderResult = await client.query(
                'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4) RETURNING id',
                [productId, quantity, userId, 'SUCCESS']
            );

            return {
                orderId: orderResult.rows[0].id,
                productId: productId,
                quantityOrdered: quantity,
                stockRemaining: updateResult.rows[0].stock
            };
        });

        res.status(201).json(result);
    } catch (error) {
        if (error.status === 400) {
            // Record failure outside of transaction
            await pool.query(
                'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4)',
                [productId, quantity, userId, 'FAILED_OUT_OF_STOCK']
            );
            return res.status(400).json({ error: error.message });
        }
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper for exponential backoff retry in optimistic locking
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// POST /api/orders/optimistic
app.post('/api/orders/optimistic', async (req, res) => {
    const { productId, quantity, userId } = req.body;
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const result = await withTransaction(async (client) => {
                // 1. Read product and version
                const productResult = await client.query(
                    'SELECT * FROM products WHERE id = $1',
                    [productId]
                );

                if (productResult.rows.length === 0) {
                    throw { status: 404, message: 'Product not found', retry: false };
                }

                const product = productResult.rows[0];

                // 2. Check stock
                if (product.stock < quantity) {
                    throw { status: 400, message: 'Insufficient stock', retry: false };
                }

                // 3. Conditional Update (Optimistic Lock)
                const updateResult = await client.query(
                    'UPDATE products SET stock = stock - $1, version = version + 1 WHERE id = $2 AND version = $3 RETURNING stock, version',
                    [quantity, productId, product.version]
                );

                if (updateResult.rowCount === 0) {
                    // Conflict detected
                    throw { status: 409, message: 'Conflict', retry: true };
                }

                // 4. Create order record
                const orderResult = await client.query(
                    'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4) RETURNING id',
                    [productId, quantity, userId, 'SUCCESS']
                );

                return {
                    orderId: orderResult.rows[0].id,
                    productId: productId,
                    quantityOrdered: quantity,
                    stockRemaining: updateResult.rows[0].stock,
                    newVersion: updateResult.rows[0].version
                };
            });

            return res.status(201).json(result);
        } catch (error) {
            if (error.retry && attempt < maxRetries - 1) {
                attempt++;
                const backoff = Math.pow(2, attempt) * 50; // 100ms, 200ms...
                console.log(`Optimistic lock conflict on attempt ${attempt}. Retrying in ${backoff}ms...`);
                await sleep(backoff);
                continue;
            }

            if (error.status === 400) {
                // Record failure outside of transaction
                await pool.query(
                    'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4)',
                    [productId, quantity, userId, 'FAILED_OUT_OF_STOCK']
                );
                return res.status(400).json({ error: error.message });
            }

            if (error.status === 409) {
                // Log failed conflict in database before final failure
                await pool.query(
                    'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4)',
                    [productId, quantity, userId, 'FAILED_CONFLICT']
                );
                return res.status(409).json({ error: 'Failed to place order due to concurrent modification. Please try again.' });
            }

            if (error.status) {
                return res.status(error.status).json({ error: error.message });
            }

            console.error(error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// GET /api/orders/stats
app.get('/api/orders/stats', async (req, res) => {
    try {
        const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_orders,
        COUNT(*) FILTER (WHERE status = 'FAILED_OUT_OF_STOCK') as failed_out_of_stock,
        COUNT(*) FILTER (WHERE status = 'FAILED_CONFLICT') as failed_conflict
      FROM orders
    `);

        const stats = statsResult.rows[0];
        res.json({
            totalOrders: parseInt(stats.total_orders),
            successfulOrders: parseInt(stats.successful_orders),
            failedOutOfStock: parseInt(stats.failed_out_of_stock),
            failedConflict: parseInt(stats.failed_conflict)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/orders/{orderId}
app.get('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
