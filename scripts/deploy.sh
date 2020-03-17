#!/bin/sh

/scripts/deploy.sh -t helm -c community -a "\
 --set image.tag=${CIRCLE_TAG}\
 --set matrixbot.username=$W3F_MATRIXBOT_USERNAME\
 --set matrixbot.password=$W3F_MATRIXBOT_PASSWORD\
 matrix-recorder w3f/matrix-recorder"
