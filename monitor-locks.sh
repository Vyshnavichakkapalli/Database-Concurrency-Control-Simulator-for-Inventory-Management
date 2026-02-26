#!/bin/bash
# monitor-locks.sh (for PostgreSQL inside container)

echo "To monitor locks, run this command in your terminal:"
echo "docker exec -it \$(docker ps -qf \"name=db\") psql -U user -d inventory_db -c \"SELECT relation::regclass, locktype, mode, granted FROM pg_locks WHERE pid IN (SELECT pid FROM pg_stat_activity WHERE datname = 'inventory_db');\""

# Automated loop for monitoring if possible (local env dependent)
while true; do
  clear
  echo "--- Active Locks at $(date) ---"
  docker exec db psql -U user -d inventory_db -c "SELECT relation::regclass, locktype, mode, granted FROM pg_locks WHERE pid IN (SELECT pid FROM pg_stat_activity WHERE datname = 'inventory_db');" 2>/dev/null || echo "Database container not reachable."
  sleep 2
done
