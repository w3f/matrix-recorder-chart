#!/bin/sh

/scripts/deploy.sh -t helm -c community -a "\
 --set image.tag=${CIRCLE_TAG}\
 --set baseUrl=$BASE_URL\
 --set accessToken=$W3F_BACKUPBOT_ACCESS_TOKEN\
 --set deviceId=$W3F_BACKUPBOT_DEVICE_ID\
 --set userId=$W3F_BACKUPBOT_USER_ID\
 matrix-recorder w3f/matrix-recorder"
