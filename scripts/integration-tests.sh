#!/bin/bash

source /scripts/common.sh
source /scripts/bootstrap-helm.sh


run_tests() {
    echo Running tests...

    wait_pod_ready matrix-recorder
    integration_test_sequence
}

integration_test_sequence(){
  echo Running integration tests...
}

teardown() {
    helmfile delete
}

main(){
    run_tests
}

main
