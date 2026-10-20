# Use official PostgreSQL image
FROM postgres:15-alpine

# Note: Environment variables (POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD)
# are provided by docker-compose.yml from the root .env file
# No default values needed here as they are set via docker-compose

# Copy initialization scripts
COPY src/schema.sql /docker-entrypoint-initdb.d/01-schema.sql
COPY src/migrate.sql /docker-entrypoint-initdb.d/02-migrate.sql

# Expose PostgreSQL port
EXPOSE 5432

# Over TCP, not the socket: while the init scripts run on an empty volume,
# Postgres answers on the socket only. Checked on the socket, the database is
# "healthy" too early and the API (depends_on: service_healthy) starts, fails
# to connect and restarts, which fails the deploy check.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD pg_isready -h 127.0.0.1 -U $POSTGRES_USER -d $POSTGRES_DB || exit 1

# Data volume
VOLUME ["/var/lib/postgresql/data"]
