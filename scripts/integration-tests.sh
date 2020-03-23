#!/bin/bash

source /scripts/common.sh
source /scripts/bootstrap-helm.sh
set -ex


run_tests() {
  echo Running tests...
  wait_pod_ready matrix-recorder-0 default 3/3
}

teardown() {
  helm delete matrix-recorder
}

main(){
  if [ -z "$KEEP_W3F_MATRIX_REC" ]; then
      trap teardown EXIT
  fi
  echo Installing...
  helm install --set matrixbot.username="${W3F_MATRIXBOT_USERNAME}" --set matrixbot.password="${W3F_MATRIXBOT_PASSWORD}" --set environment="ci" --set certificate.enabled="false" matrix-recorder ./charts/matrix-recorder

  run_tests

}

main
set +x
