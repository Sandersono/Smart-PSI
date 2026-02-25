#!/usr/bin/env sh
set -eu

if [ -z "${APP_INTERNAL_URL:-}" ]; then
  echo "APP_INTERNAL_URL is required (ex: http://127.0.0.1:3000)."
  exit 1
fi

if [ -z "${INTERNAL_JOB_TOKEN:-}" ]; then
  echo "INTERNAL_JOB_TOKEN is required."
  exit 1
fi

if [ -z "${CLINIC_ID:-}" ] || [ -z "${JOB_USER_ID:-}" ]; then
  echo "CLINIC_ID and JOB_USER_ID are required."
  exit 1
fi

curl --fail --show-error --silent \
  -X POST "${APP_INTERNAL_URL}/api/internal/jobs/monthly-billing" \
  -H "Content-Type: application/json" \
  -H "x-job-token: ${INTERNAL_JOB_TOKEN}" \
  -d "{\"clinic_id\":\"${CLINIC_ID}\",\"user_id\":\"${JOB_USER_ID}\"}"
