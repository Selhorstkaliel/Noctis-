#!/bin/sh
set -eu
# Railway volumes start root-owned. Initialize only the application's mount
# directory, then drop privileges before starting the API or worker.
if [ "$(id -u)" = "0" ]; then
  if [ "${STORAGE_DRIVER:-local}" = "local" ]; then
    if [ "${STORAGE_PATH:-}" != "/var/lib/noctis/uploads" ]; then
      echo "Root initialization requires STORAGE_PATH=/var/lib/noctis/uploads" >&2
      exit 1
    fi
    mkdir -p /var/lib/noctis/uploads
    chown node:node /var/lib/noctis/uploads
    chmod 700 /var/lib/noctis/uploads
  fi
  exec gosu node "$@"
fi
exec "$@"
