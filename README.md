<<<<<<< HEAD
# Database Concurrency Control Simulator

This project simulates an inventory management system to compare **Pessimistic** and **Optimistic** locking strategies for handling concurrent order requests.

## Setup and Run

1.  **Clone the repository**.
git clone https://github.com/Vyshnavichakkapalli/Database-Concurrency-Control-Simulator-for-Inventory-Management

cd Database-Concurrency-Control-Simulator-for-Inventory-Management"

2.  **Create a .env file** from the example:
    ```bash
    cp .env.example .env
    ```
3.  **Start the services** using Docker Compose:
    ```bash
    docker-compose up --build
    ```
4.  The API will be available at `http://localhost:8080`.

## API Endpoints

-   `GET /api/products/{id}`: Get product details.
-   `GET /api/orders/{id}`: Get order details.
-   `POST /api/products/reset`: Reset inventory and clear orders.
-   `POST /api/orders/pessimistic`: Place an order using pessimistic locking (`SELECT ... FOR UPDATE`).
-   `POST /api/orders/optimistic`: Place an order using optimistic locking (version-based with 3 retries).
-   `GET /api/orders/stats`: View order processing statistics.
-   `GET /health`: Health check endpoint.

## Testing Concurrency

### 1. Run Concurrent Test Script
Use the provided script to simulate 20 simultaneous requests:
```bash
./concurrent-test.sh pessimistic
# OR
./concurrent-test.sh optimistic
```

### 2. Monitor Database Locks
In a separate terminal, run:
```bash
./monitor-locks.sh
```
This shows active row-level locks when multiple pessimistic requests are processed.

## Implementation Details

### Pessimistic Locking
Uses database-level row locks (`FOR UPDATE`). This ensures that only one transaction can access a product row at a time, preventing race conditions but potentially causing waits under high contention.

### Optimistic Locking
Uses a `version` column. It checks if the version has changed since it was read. If it has, the transaction fails and retries (up to 3 times) with exponential backoff. This allows higher concurrency but results in conflicts if many transactions target the same row concurrently.

## Submission Artifacts
- `index.js`, `db.js`, `package.json`
- `Dockerfile`, `docker-compose.yml`
- `.env.example`
- `seeds/init.sql`
- `concurrent-test.sh`, `monitor-locks.sh`
=======
# Database-Concurrency-Control-Simulator-for-Inventory-Management
>>>>>>> 736fa3c0f1935c0a88c21942b2f874055bb9453c
