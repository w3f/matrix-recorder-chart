#!/bin/bash

source /scripts/common.sh
source /scripts/bootstrap-helm.sh


run_tests() {
    echo Running tests...
    wait_pod_ready matrix-recorder-0
}

teardown() {
    helm delete matrix-recorder
}

main(){
    if [ -z "$KEEP_W3F_MATRIX_REC" ]; then
        trap teardown EXIT
    fi

    helm install --set matrixbot.username="${W3F_MATRIXBOT_USERNAME}" --set matrixbot.password="${W3F_MATRIXBOT_PASSWORD}" --set environment="ci" matrix-recorder ./charts/matrix-recorder

    run_tests
}

main
