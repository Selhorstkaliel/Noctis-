#!/bin/sh
set -eu
mkdir -p /tmp/noctis-tls
cp /run/secrets/postgres_cert /tmp/noctis-tls/server.crt
cp /run/secrets/postgres_key /tmp/noctis-tls/server.key
cp /run/secrets/postgres_ca /tmp/noctis-tls/ca.crt
chown -R postgres:postgres /tmp/noctis-tls
chmod 600 /tmp/noctis-tls/server.key
exec /usr/local/bin/docker-entrypoint.sh postgres \
  -c ssl=on \
  -c hba_file=/opt/noctis/pg_hba.conf \
  -c ssl_min_protocol_version=TLSv1.2 \
  -c ssl_cert_file=/tmp/noctis-tls/server.crt \
  -c ssl_key_file=/tmp/noctis-tls/server.key \
  -c ssl_ca_file=/tmp/noctis-tls/ca.crt \
  -c password_encryption=scram-sha-256 \
  -c log_statement=none \
  -c log_parameter_max_length_on_error=0
