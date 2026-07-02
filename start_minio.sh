#!/bin/bash
setsid /tmp/minio server /tmp/minio-data --address :9000 --console-address :9001 > /tmp/minio.log 2>&1 &
sleep 3
ss -tlnp | grep 9000
echo "MinIO started"
